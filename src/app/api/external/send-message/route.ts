import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'

export async function POST(request: Request) {
  try {
    // 1. Security Check (Secret authentication)
    const secretHeader = request.headers.get('x-api-secret')
    const expectedSecret = process.env.N8N_BRIDGE_SECRET

    if (!expectedSecret || secretHeader !== expectedSecret) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 2. Parse and Validate Body Inputs
    const body = await request.json()
    const { phoneNumber, message, accountId, type = 'text', interactive } = body

    if (!phoneNumber || !accountId) {
      return NextResponse.json(
        { error: 'phoneNumber and accountId are required' },
        { status: 400 }
      )
    }

    if (type !== 'text' && type !== 'interactive') {
      return NextResponse.json(
        { error: `Unsupported type "${type}". Allowed values are "text" or "interactive".` },
        { status: 400 }
      )
    }

    if (type === 'text' && !message) {
      return NextResponse.json(
        { error: 'message is required for text messages' },
        { status: 400 }
      )
    }

    if (type === 'interactive' && (!interactive || typeof interactive !== 'object')) {
      return NextResponse.json(
        { error: 'interactive object is required for interactive messages' },
        { status: 400 }
      )
    }

    const normalizedPhone = normalizePhone(phoneNumber)
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    const db = supabaseAdmin()

    // 3. Fetch Config from whatsapp_config
    const { data: config, error: configError } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError || !config) {
      console.error('[external/send-message] Config fetch error:', configError)
      return NextResponse.json(
        { error: 'WhatsApp is not configured for this account' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // 4. Send Message via Meta Cloud API
    let waMessageId: string
    try {
      if (type === 'interactive') {
        const url = `https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: normalizedPhone,
            type: 'interactive',
            interactive,
          }),
        })

        if (!response.ok) {
          let errorMsg = `Meta API error: ${response.status}`
          try {
            const data = await response.json()
            if (data.error?.message) errorMsg = data.error.message
          } catch {}
          throw new Error(errorMsg)
        }

        const data = await response.json()
        waMessageId = data.messages[0].id
      } else {
        // Fallback to text send
        const result = await sendTextMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: normalizedPhone,
          text: message,
        })
        waMessageId = result.messageId
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[external/send-message] Meta API send failed:', errMsg)
      return NextResponse.json(
        { error: `Meta API error: ${errMsg}` },
        { status: 502 }
      )
    }

    // 5. Resolve/Create Contact (CRM Sync)
    let contact: any = null
    const existingContact = await findExistingContact(db, accountId, normalizedPhone)

    if (existingContact) {
      contact = existingContact
    } else {
      const { data: newContact, error: createError } = await db
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: config.user_id, // Link to the WhatsApp config's owner/creator user ID
          phone: normalizedPhone,
          name: normalizedPhone,    // Default name is phone number
        })
        .select()
        .single()

      if (createError) {
        if (isUniqueViolation(createError)) {
          const raced = await findExistingContact(db, accountId, normalizedPhone)
          if (raced) {
            contact = raced
          }
        }
        if (!contact) {
          console.error('[external/send-message] Error creating contact:', createError)
          return NextResponse.json(
            { error: `Failed to create contact: ${createError.message}` },
            { status: 500 }
          )
        }
      } else {
        contact = newContact
      }
    }

    // 6. Resolve/Create Conversation (CRM Sync)
    let conversation: any = null
    const { data: existingConv, error: findError } = await db
      .from('conversations')
      .select('*')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .maybeSingle()

    if (findError) {
      console.error('[external/send-message] Error finding conversation:', findError)
      return NextResponse.json(
        { error: `Database error: ${findError.message}` },
        { status: 500 }
      )
    }

    if (existingConv) {
      conversation = existingConv
    } else {
      const { data: newConv, error: createError } = await db
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: config.user_id,
          contact_id: contact.id,
        })
        .select()
        .single()

      if (createError) {
        console.error('[external/send-message] Error creating conversation:', createError)
        return NextResponse.json(
          { error: `Failed to create conversation: ${createError.message}` },
          { status: 500 }
        )
      }
      conversation = newConv
    }

    // Determine what content text to save for visual rendering in the Inbox UI
    let contentText = message
    if (type === 'interactive') {
      const interactiveType = interactive.type
      if (interactiveType === 'flow') {
        contentText = interactive.body?.text || interactive.action?.flow_cta || interactive.action?.parameters?.flow_cta || '[Flow Sent]'
      } else if (interactiveType === 'product_list') {
        contentText = interactive.header?.text || '[Catalog Sent]'
      } else {
        contentText = interactive.body?.text || '[Interactive Message]'
      }
    }

    // 7. Insert message record (so it shows in the UI)
    const { data: messageRecord, error: msgError } = await db
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'agent',
        content_type: type === 'interactive' ? 'interactive' : 'text',
        content_text: contentText,
        message_id: waMessageId,
        status: 'sent',
      })
      .select()
      .single()

    if (msgError) {
      console.error('[external/send-message] Error inserting sent message:', msgError)
      return NextResponse.json(
        { error: `Message sent to Meta but failed to save to DB: ${msgError.message}` },
        { status: 500 }
      )
    }

    // Update conversation last message details
    const { error: convUpdateError } = await db
      .from('conversations')
      .update({
        last_message_text: contentText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)

    if (convUpdateError) {
      console.error('[external/send-message] Error updating conversation:', convUpdateError)
    }

    // 8. Pause active chatbot flows for this contact to prevent collision
    try {
      const { error: pauseErr } = await db
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .eq('status', 'active')

      if (pauseErr) {
        console.error('[external/send-message] pause-on-agent-send failed:', pauseErr.message)
      }
    } catch (err) {
      console.error(
        '[external/send-message] pause-on-agent-send threw:',
        err instanceof Error ? err.message : err
      )
    }

    // Return success response with generated IDs
    return NextResponse.json({
      success: true,
      messageId: messageRecord.id,
      whatsappMessageId: waMessageId,
    })

  } catch (error) {
    console.error('[external/send-message] Error in POST handler:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
