// Bulk import for the Contacts module. Reads an Excel (.xlsx / .xls) or CSV
// file in the browser via SheetJS, auto-maps the user's column headers to
// the import schema, shows a per-row preview with errors, and on confirm
// hits POST /contacts/import — which merges by email (appending the new
// phone if different), auto-creates organizations by name, and links to
// existing group entities by short_name.
//
// Two-step UX:
//   1. Pick a file → frontend parses + previews (and runs a backend dry_run
//      to compute "X new / Y to merge" before any DB write).
//   2. Click Import → real run, summary toast, refresh the parent list.

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FileSpreadsheet, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ContactCategory } from "@/types";

type ImportRow = {
  full_name: string;
  category: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  organization_name?: string | null;
  notes?: string | null;
  company_short_names?: string[] | null;
};

type RowState = {
  row: ImportRow;
  rowIndex: number;     // index in the file (after header), 1-based
  localError?: string;  // problems we can detect client-side: missing name, bad category
};

const ALLOWED_CATEGORIES: ContactCategory[] = [
  "ca", "cs", "auditor", "lawyer", "banker", "insurance", "investor", "govt_official",
  "client_poc", "vendor_poc", "channel_partner", "collaborator",
  "advisor", "mentor", "press", "industry_body",
  "college", "tpo", "training_institute", "recruitment_agency",
  "domain_registrar", "hosting_saas", "agency", "other",
];

// Case-insensitive column-name aliases. Cell value goes into the import row
// under the first key that matches a header in the sheet. Aliases mirror what
// HR sheets commonly use; expand as we see real columns in the wild.
const COLUMN_ALIASES: Record<keyof ImportRow, string[]> = {
  full_name:          ["full name", "name", "contact name", "person"],
  category:           ["category", "type", "contact type", "kind"],
  role:               ["role", "designation", "title", "position"],
  email:              ["email", "email id", "e-mail", "mail"],
  phone:              ["phone", "phone number", "mobile", "mobile number", "contact number", "number"],
  organization_name:  ["organization", "organisation", "company", "firm", "office", "vendor", "client"],
  notes:              ["notes", "remarks", "comments", "description"],
  company_short_names: ["linked to", "linked entities", "entity", "group entity", "our company"],
};

function normalizeHeader(s: string): string {
  return s.toString().trim().toLowerCase().replace(/[._-]/g, " ").replace(/\s+/g, " ");
}

function buildHeaderIndex(headers: string[]): Record<keyof ImportRow, number> {
  const idx: Partial<Record<keyof ImportRow, number>> = {};
  const normHeaders = headers.map(normalizeHeader);
  (Object.keys(COLUMN_ALIASES) as (keyof ImportRow)[]).forEach((field) => {
    for (const alias of COLUMN_ALIASES[field]) {
      const i = normHeaders.indexOf(alias);
      if (i !== -1) {
        idx[field] = i;
        return;
      }
    }
  });
  return idx as Record<keyof ImportRow, number>;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return String(v).trim();
}

function parseSheet(file: File): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // header:1 returns array-of-arrays — easier to map headers to indices.
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
        if (rows.length === 0) return resolve({ headers: [], rows: [] });
        const headers = (rows[0] as unknown[]).map(cellToString);
        const body = rows.slice(1)
          .filter((r) => (r as unknown[]).some((c) => cellToString(c) !== ""))
          .map((r) => {
            const obj: Record<string, unknown> = {};
            headers.forEach((h, i) => { obj[h] = (r as unknown[])[i]; });
            return obj;
          });
        resolve({ headers, rows: body });
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function mapToImportRows(headers: string[], raws: Record<string, unknown>[]): RowState[] {
  const idx = buildHeaderIndex(headers);
  return raws.map((raw, i) => {
    const get = (field: keyof ImportRow): string => {
      const col = idx[field];
      if (col === undefined) return "";
      return cellToString(Object.values(raw)[col]);
    };

    const full_name = get("full_name");
    const categoryRaw = get("category").toLowerCase().replace(/[ -]/g, "_");
    const company_short_names = get("company_short_names")
      .split(/[;,|]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const row: ImportRow = {
      full_name,
      category: categoryRaw,
      role: get("role") || null,
      email: get("email") || null,
      phone: get("phone") || null,
      organization_name: get("organization_name") || null,
      notes: get("notes") || null,
      company_short_names: company_short_names.length ? company_short_names : null,
    };

    let localError: string | undefined;
    if (!full_name) localError = "Missing name";
    else if (!categoryRaw) localError = "Missing category";
    else if (!ALLOWED_CATEGORIES.includes(categoryRaw as ContactCategory))
      localError = `Unknown category "${categoryRaw}"`;

    return { row, rowIndex: i + 2 /* +1 header row, +1 for 1-based */, localError };
  });
}

// Exported so the Contacts page can offer a top-level "Download format"
// button without forcing the user through the Import dialog first. Builds
// a workbook with header row + one example row + a hidden "Valid categories"
// sheet so HR knows what to put in the Category column.
export function downloadContactsTemplate() {
  const sample = [
    {
      "Full Name": "Rajesh Kumar",
      "Category": "ca",
      "Role": "Partner",
      "Email": "rajesh@kumarca.in",
      "Phone": "9849123456",
      "Organization": "Kumar & Associates CA Firm",
      "Notes": "Handles GST filings for Innomax IT",
      "Linked to": "Innomax IT; Healtour",
    },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sample), "Contacts");
  const cats = ALLOWED_CATEGORIES.map((c) => ({ category: c }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cats), "Valid categories");
  XLSX.writeFile(wb, "kiron-contacts-template.xlsx");
}

export function ContactsImportDialog({
  open, onOpenChange, onComplete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onComplete: () => void;
}) {
  const { toast } = useToast();
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<RowState[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  // Dry-run result from the backend — the authoritative "will create N new,
  // merge M" preview. Computed after the user picks a file, before they hit
  // Import. Local validation only catches client-detectable issues.
  const [preview, setPreview] = useState<{
    created: number; merged: number;
    created_organizations: number; created_company_links: number;
    errors: Array<{ row: number; name: string; error: string }>;
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setRows([]);
    setFileName(null);
    setPreview(null);
  };

  const handleFile = async (file: File) => {
    reset();
    setFileName(file.name);
    setParsing(true);
    try {
      const { headers, rows: raws } = await parseSheet(file);
      if (raws.length === 0) {
        toast({ title: "Empty file", description: "No data rows found below the header.", variant: "destructive" });
        return;
      }
      const mapped = mapToImportRows(headers, raws);
      setRows(mapped);
      // Auto-run a dry import so the user sees real new/merge counts.
      // Skip rows with client-side errors — they'll show separately.
      const valid = mapped.filter((r) => !r.localError).map((r) => r.row);
      if (valid.length === 0) return;
      setPreviewing(true);
      try {
        const res = await api.importContacts({ rows: valid, dry_run: true });
        setPreview(res);
      } catch (e) {
        toast({ title: "Preview failed", description: e instanceof ApiError ? e.message : "Try again.", variant: "destructive" });
      } finally {
        setPreviewing(false);
      }
    } catch (e) {
      toast({
        title: "Couldn't parse the file",
        description: e instanceof Error ? e.message : "Unsupported format. Use .xlsx, .xls, or .csv.",
        variant: "destructive",
      });
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    const valid = rows.filter((r) => !r.localError).map((r) => r.row);
    if (valid.length === 0) {
      toast({ title: "Nothing to import", description: "All rows had errors.", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const res = await api.importContacts({ rows: valid, dry_run: false });
      const lines = [`${res.created} new`, `${res.merged} merged`];
      if (res.created_organizations) lines.push(`${res.created_organizations} new organizations`);
      if (res.errors.length) lines.push(`${res.errors.length} errors`);
      toast({ title: "Import complete", description: lines.join(" · ") });
      onComplete();
      onOpenChange(false);
      reset();
    } catch (e) {
      toast({ title: "Import failed", description: e instanceof ApiError ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const errorRows = useMemo(() => rows.filter((r) => r.localError), [rows]);
  const validRows = useMemo(() => rows.filter((r) => !r.localError), [rows]);
  // Backend-side errors keyed by row index (the original 0-based index in
  // the array we sent, which we filtered to valid rows). Translate back to
  // the file's 1-based row number for display.
  const backendErrors = useMemo(() => {
    if (!preview?.errors) return new Map<number, string>();
    const m = new Map<number, string>();
    preview.errors.forEach((e) => {
      const rs = validRows[e.row];
      if (rs) m.set(rs.rowIndex, e.error);
    });
    return m;
  }, [preview, validRows]);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" /> Import contacts from Excel
          </DialogTitle>
          <DialogDescription>
            Upload an .xlsx, .xls, or .csv file. Existing contacts with the same email
            are merged — phone numbers are appended, not replaced. Unknown organizations
            are auto-created. Rows with errors are skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* File picker + template download row */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-muted">
              <FileSpreadsheet className="h-4 w-4" />
              <span>{fileName ?? "Choose file..."}</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = ""; // reset so re-selecting the same file fires onChange
                }}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={downloadContactsTemplate} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> Download template
            </Button>
            {(parsing || previewing) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {/* Summary banner once parsed */}
          {rows.length > 0 && (
            <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span><b>{rows.length}</b> rows in file</span>
                {preview && (
                  <>
                    <span className="flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {preview.created} new
                    </span>
                    <span className="flex items-center gap-1 text-info">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {preview.merged} to merge
                    </span>
                    {preview.created_organizations > 0 && (
                      <span className="text-muted-foreground">
                        +{preview.created_organizations} new organizations
                      </span>
                    )}
                  </>
                )}
                {(errorRows.length > 0 || (preview?.errors?.length ?? 0) > 0) && (
                  <span className="flex items-center gap-1 text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {errorRows.length + (preview?.errors?.length ?? 0)} errors
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Row preview table */}
          {rows.length > 0 && (
            <div className="max-h-[40vh] overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-muted text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5">Row</th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Category</th>
                    <th className="px-2 py-1.5">Email</th>
                    <th className="px-2 py-1.5">Phone</th>
                    <th className="px-2 py-1.5">Organization</th>
                    <th className="px-2 py-1.5">Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const err = r.localError ?? backendErrors.get(r.rowIndex);
                    return (
                      <tr key={r.rowIndex} className={err ? "bg-destructive/5" : "border-t border-border"}>
                        <td className="px-2 py-1 font-mono text-muted-foreground">{r.rowIndex}</td>
                        <td className="px-2 py-1">{r.row.full_name || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-2 py-1 font-mono text-[10px]">{r.row.category || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-2 py-1">{r.row.email || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-2 py-1">{r.row.phone || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-2 py-1">{r.row.organization_name || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-2 py-1 text-destructive">{err || ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!rows.length && (
            <p className="rounded-md bg-surface-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Tip: the template has the exact column names the importer auto-maps. Common variations
              like "Name", "Mobile", "Company" also work. Multiple group entities can go in one cell
              separated by <code>;</code> (e.g. "Innomax IT; Healtour").
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={importing || !preview || (preview.created + preview.merged === 0)}
          >
            {importing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Import {preview ? `${preview.created + preview.merged} contacts` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
