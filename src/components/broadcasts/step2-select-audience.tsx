'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CustomField, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
  Plus,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv';
type CustomFieldOperator = 'is' | 'is_not' | 'contains';

interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
}

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

const audienceOptions: {
  type: AudienceType;
  label: string;
  description: string;
  icon: typeof Users;
}[] = [
  {
    type: 'all',
    label: 'All Contacts',
    description: 'Send to every contact in your database',
    icon: Users,
  },
  {
    type: 'tags',
    label: 'Filter by Tags',
    description: 'Target contacts with specific tags',
    icon: Tags,
  },
  {
    type: 'custom_field',
    label: 'Custom Field',
    description: 'Filter by a custom field value',
    icon: Filter,
  },
  {
    type: 'csv',
    label: 'Upload CSV',
    description: 'Upload a list of phone numbers',
    icon: Upload,
  },
];

const OPERATOR_OPTIONS: { value: CustomFieldOperator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
];

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);

  // Manual entry states
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualError, setManualError] = useState('');

  // Upload preview states
  const [uploadPreviewRows, setUploadPreviewRows] = useState<{ phone: string; name?: string }[] | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [mappedColumns, setMappedColumns] = useState<{ phone: string; name: string } | null>(null);

  function handleAddManualContact() {
    setManualError('');
    const rawPhone = manualPhone.trim();
    if (!rawPhone) {
      setManualError('Phone number is required.');
      return;
    }

    // Auto-prepend 91 if it's 10 digits
    const digitsOnly = rawPhone.replace(/\D/g, '');
    let formattedPhone = digitsOnly;
    if (digitsOnly.length === 10) {
      formattedPhone = '91' + digitsOnly;
    }

    if (!/^[1-9]\d{6,14}$/.test(formattedPhone)) {
      setManualError('Invalid phone number format. Should be 7-15 digits.');
      return;
    }

    const currentContacts = audience.csvContacts ?? [];
    if (currentContacts.some(c => c.phone === formattedPhone)) {
      setManualError('This phone number is already in the list.');
      return;
    }

    onUpdate({
      ...audience,
      csvContacts: [
        ...currentContacts,
        {
          phone: formattedPhone,
          name: manualName.trim() || undefined
        }
      ]
    });

    setManualPhone('');
    setManualName('');
    toast.success('Recipient added.');
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingFile(true);
    setUploadedFileName(file.name);
    setUploadPreviewRows(null);
    setMappedColumns(null);

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

    try {
      if (isExcel) {
        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const data = new Uint8Array(evt.target?.result as ArrayBuffer);
            const XLSX = await import('xlsx');
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
            processRawRows(rows);
          } catch (err) {
            console.error(err);
            toast.error('Failed to parse Excel file.');
            setIsParsingFile(false);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const text = evt.target?.result as string;
            const rows = parseCsvText(text);
            processRawRows(rows);
          } catch (err) {
            console.error(err);
            toast.error('Failed to parse CSV file.');
            setIsParsingFile(false);
          }
        };
        reader.readAsText(file);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to process file.');
      setIsParsingFile(false);
    }
  }

  function parseCsvText(text: string): string[][] {
    const lines = text.split(/\r?\n/);
    return lines.map(line => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      return values;
    });
  }

  function processRawRows(rawRows: any[][]) {
    if (rawRows.length < 2) {
      toast.error('The file must contain a header row and at least one contact row.');
      setIsParsingFile(false);
      return;
    }

    const headers = rawRows[0].map(h => String(h || '').trim().toLowerCase());
    
    // Look for headers like 'phone', 'mobile', 'number', 'name', 'contact'
    const phoneHeaders = ['phone', 'mobile', 'number', 'contact', 'wa_id'];
    const nameHeaders = ['name', 'fullname', 'contactname', 'firstname', 'customer'];

    let phoneIdx = headers.findIndex(h => phoneHeaders.some(p => h.includes(p)));
    let nameIdx = headers.findIndex(h => nameHeaders.some(n => h.includes(n)));

    // Fallbacks
    if (phoneIdx === -1) phoneIdx = 0;
    if (nameIdx === -1 && phoneIdx !== 1) nameIdx = 1;

    setMappedColumns({
      phone: rawRows[0][phoneIdx] || `Column ${phoneIdx + 1}`,
      name: nameIdx !== -1 ? rawRows[0][nameIdx] || `Column ${nameIdx + 1}` : 'N/A'
    });

    const parsed: { phone: string; name?: string }[] = [];
    const CHUNK_SIZE = 2000;
    let currentIndex = 1;

    function processChunk() {
      const end = Math.min(rawRows.length, currentIndex + CHUNK_SIZE);
      for (let i = currentIndex; i < end; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        let rawPhone = String(row[phoneIdx] || '').trim();
        const rawName = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : '';

        if (!rawPhone) continue;

        // Formatting: Prepend '91' if exactly 10 digits
        const digitsOnly = rawPhone.replace(/\D/g, '');
        let phone = digitsOnly;
        if (digitsOnly.length === 10) {
          phone = '91' + digitsOnly;
        }

        if (phone && /^[1-9]\d{6,14}$/.test(phone)) {
          parsed.push({
            phone,
            name: rawName || undefined
          });
        }
      }

      currentIndex = end;
      if (currentIndex < rawRows.length) {
        setTimeout(processChunk, 0);
      } else {
        setIsParsingFile(false);
        if (parsed.length === 0) {
          toast.error('No valid phone numbers found in the file.');
          setUploadPreviewRows(null);
          setMappedColumns(null);
          setUploadedFileName(null);
        } else {
          setUploadPreviewRows(parsed);
        }
      }
    }

    processChunk();
  }

  function handleConfirmImport() {
    if (!uploadPreviewRows) return;
    const current = audience.csvContacts ?? [];
    
    // De-dupe: prevent adding duplicates of already existing contacts
    const seenPhones = new Set(current.map(c => c.phone));
    const toAdd = uploadPreviewRows.filter(c => !seenPhones.has(c.phone));

    onUpdate({
      ...audience,
      csvContacts: [...current, ...toAdd]
    });

    toast.success(`Successfully imported ${toAdd.length} new recipients.`);
    setUploadPreviewRows(null);
    setUploadedFileName(null);
    setMappedColumns(null);
  }

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('custom_fields')
          .select('*')
          .order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  const fetchEstimatedCount = useCallback(async () => {
    setLoadingCount(true);
    try {
      const supabase = createClient();

      // Base query — produces the superset before exclude is applied.
      let baseIds: Set<string> | null = null; // null means "all contacts"

      if (audience.type === 'all') {
        // Handled below — full-table count adjusted by excludes.
      } else if (
        audience.type === 'tags' &&
        audience.tagIds &&
        audience.tagIds.length > 0
      ) {
        const { data } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.tagIds);
        baseIds = new Set((data ?? []).map((r) => r.contact_id));
      } else if (
        audience.type === 'custom_field' &&
        audience.customField?.fieldId &&
        audience.customField.value
      ) {
        const { fieldId, operator, value } = audience.customField;
        let q = supabase
          .from('contact_custom_values')
          .select('contact_id')
          .eq('custom_field_id', fieldId);
        if (operator === 'is') q = q.eq('value', value);
        else if (operator === 'is_not') q = q.neq('value', value);
        else q = q.ilike('value', `%${value}%`);
        const { data } = await q;
        baseIds = new Set((data ?? []).map((r) => r.contact_id));
      } else if (
        audience.type === 'csv' &&
        audience.csvContacts &&
        audience.csvContacts.length > 0
      ) {
        setEstimatedCount(audience.csvContacts.length);
        return;
      } else {
        // Partially-configured audience — wait for the user to finish.
        setEstimatedCount(null);
        return;
      }

      // Apply exclude tags
      let excludeSet: Set<string> | null = null;
      if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
        const { data: excludeRows } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.excludeTagIds);
        excludeSet = new Set((excludeRows ?? []).map((r) => r.contact_id));
      }

      if (baseIds) {
        const effective = [...baseIds].filter(
          (id) => !excludeSet?.has(id),
        );
        setEstimatedCount(effective.length);
      } else {
        // "All" — fetch the total, then subtract exclude set if any.
        const { count } = await supabase
          .from('contacts')
          .select('*', { count: 'exact', head: true });
        const total = count ?? 0;
        setEstimatedCount(excludeSet ? Math.max(0, total - excludeSet.size) : total);
      }
    } finally {
      setLoadingCount(false);
    }
  }, [
    audience.type,
    audience.tagIds,
    audience.customField,
    audience.csvContacts,
    audience.excludeTagIds,
  ]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      !!audience.customField?.fieldId &&
      audience.customField.value.length > 0) ||
    (audience.type === 'csv' &&
      audience.csvContacts &&
      audience.csvContacts.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Select Audience</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose who will receive this broadcast.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map((option) => {
          const isSelected = audience.type === option.type;
          const Icon = option.icon;
          return (
            <button
              key={option.type}
              onClick={() =>
                onUpdate({
                  ...audience,
                  type: option.type,
                  // Wipe shape fields from other types to avoid stale
                  // config leaking across selections.
                  tagIds: option.type === 'tags' ? audience.tagIds : undefined,
                  customField:
                    option.type === 'custom_field'
                      ? audience.customField
                      : undefined,
                  csvContacts:
                    option.type === 'csv' ? audience.csvContacts : undefined,
                })
              }
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-card/50 hover:border-border'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{option.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {audience.type === 'tags' && (
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">Select Tags</p>
          {loadingTags ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No tags found. Create tags in Settings.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-muted text-muted-foreground hover:border-border'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience.type === 'custom_field' && (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-medium text-foreground">Custom Field Filter</p>
          {loadingFields ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : customFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No custom fields defined. Create one in Settings → Custom Fields.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
              <select
                value={audience.customField?.fieldId ?? ''}
                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select field…</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
              <select
                value={audience.customField?.operator ?? 'is'}
                onChange={(e) =>
                  updateCustomField({
                    operator: e.target.value as CustomFieldOperator,
                  })
                }
                className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {OPERATOR_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder="Value"
                className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
        </div>
      )}

      {/* Manual & File Import Audience Custom Component */}
      {audience.type === 'csv' && (
        <div className="space-y-6">
          {/* Manual Entry Form */}
          <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">Add Recipient Manually</p>
              <p className="text-xs text-muted-foreground">Type a number to add it to the list immediately.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] items-end">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Phone Number</Label>
                <Input
                  type="text"
                  placeholder="e.g. 9876543210"
                  value={manualPhone}
                  onChange={(e) => {
                    setManualPhone(e.target.value);
                    setManualError('');
                  }}
                  className="h-9 bg-muted text-foreground placeholder:text-muted-foreground border-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Name (Optional)</Label>
                <Input
                  type="text"
                  placeholder="e.g. Jane Doe"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="h-9 bg-muted text-foreground placeholder:text-muted-foreground border-border"
                />
              </div>
              <Button
                type="button"
                onClick={handleAddManualContact}
                className="h-9 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add
              </Button>
            </div>
            {manualError && (
              <p className="text-xs text-red-400 font-medium">{manualError}</p>
            )}
          </div>

          {/* File Upload Dropzone */}
          <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">Upload CSV or Excel File</p>
              <p className="text-xs text-muted-foreground">Upload a file (.csv, .xlsx, .xls) to parse numbers in bulk.</p>
            </div>
            
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-xl cursor-pointer bg-muted/40 hover:bg-muted/70 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  {isParsingFile ? (
                    <>
                      <Loader2 className="w-8 h-8 text-primary animate-spin mb-2" />
                      <p className="text-sm text-foreground font-medium">Parsing file...</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                      <p className="text-sm text-foreground font-medium">Click to upload file</p>
                      <p className="text-xs text-muted-foreground mt-1">.csv, .xlsx, .xls (auto-mapped headers)</p>
                    </>
                  )}
                </div>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  disabled={isParsingFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Recipient List / Count */}
          {audience.csvContacts && audience.csvContacts.length > 0 && (
            <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Recipients List</p>
                  <p className="text-xs text-muted-foreground">Total of {audience.csvContacts.length} recipient(s) in custom list</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onUpdate({ ...audience, csvContacts: [] })}
                  className="border-red-900/30 text-red-400 hover:bg-red-950/20 text-xs h-8"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Clear All
                </Button>
              </div>

              <div className="max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-muted/80 text-muted-foreground border-b border-border">
                      <th className="px-3 py-2 font-medium">Phone</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {audience.csvContacts.map((contact, idx) => (
                      <tr key={`${contact.phone}-${idx}`} className="hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-[11px] text-foreground">{contact.phone}</td>
                        <td className="px-3 py-2 text-muted-foreground">{contact.name || '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              onUpdate({
                                ...audience,
                                csvContacts: audience.csvContacts?.filter((_, index) => index !== idx)
                              });
                            }}
                            className="text-muted-foreground hover:text-red-400 transition-colors p-1"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Exclude list — applies regardless of audience type */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <X className="h-4 w-4 text-red-400" />
          <p className="text-sm font-medium text-foreground">
            Exclude contacts with these tags
          </p>
          <span className="text-xs text-muted-foreground">(optional)</span>
        </div>
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tags available.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    isExcluded
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-border bg-muted text-muted-foreground hover:border-border'
                  }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Audience Summary */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <p className="mb-2 text-sm font-medium text-foreground">Audience Summary</p>
        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Calculating…</span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm text-foreground">
              {estimatedCount.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">estimated recipients</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Select an audience type to see the estimate.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* File Import Preview Dialog */}
      <Dialog open={!!uploadPreviewRows} onOpenChange={(open) => {
        if (!open) {
          setUploadPreviewRows(null);
          setUploadedFileName(null);
          setMappedColumns(null);
        }
      }}>
        <DialogContent className="border-border bg-popover text-popover-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base text-foreground">Confirm Import</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Verify the parsed columns and data format before confirming the import.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted p-3 space-y-1.5 text-xs text-muted-foreground border border-border">
              <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider">File Details</p>
              <p><strong className="text-foreground">Name:</strong> {uploadedFileName}</p>
              <p><strong className="text-foreground">Total Rows:</strong> {uploadPreviewRows?.length ?? 0}</p>
              <p><strong className="text-foreground">Phone Mapped:</strong> {mappedColumns?.phone}</p>
              <p><strong className="text-foreground">Name Mapped:</strong> {mappedColumns?.name}</p>
            </div>
            
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Preview (First 5 records)</p>
              <div className="rounded-lg border border-border overflow-hidden bg-muted/20">
                <table className="w-full text-[11px] text-left">
                  <thead>
                    <tr className="bg-muted/80 text-muted-foreground border-b border-border">
                      <th className="px-3 py-1.5 font-medium">Phone</th>
                      <th className="px-3 py-1.5 font-medium">Name</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {uploadPreviewRows?.slice(0, 5).map((row, idx) => (
                      <tr key={idx} className="hover:bg-muted/10">
                        <td className="px-3 py-1.5 font-mono text-[10px] text-foreground">{row.phone}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setUploadPreviewRows(null);
                setUploadedFileName(null);
                setMappedColumns(null);
              }}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmImport}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Confirm Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
