// Per-company offices editor — lives inside CompanyDialog's "Offices"
// tab. Lists existing offices for the company, supports add / edit /
// deactivate inline. Each office has a name, optional address, and an
// optional geofence (latitude, longitude, radius_m). Picking a
// geofence lets attendance check-in compare the captured location
// against the office and stamp `geo_outside_office=true` for HR review
// when out of range.
//
// In CREATE mode the company doesn't have an id yet, so we render a
// placeholder pointing the user to save first.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { mapOffice } from "@/lib/mappers";
import type { Office } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MapPin, Plus, Trash2, Save, X } from "lucide-react";
import { toast } from "sonner";

type DraftOffice = {
  id?: string;
  name: string;
  address: string;
  latitude: string;     // string for input control; parsed on save
  longitude: string;
  radiusM: string;
  isActive: boolean;
  dirty: boolean;
  // True only for the row we just appended via "Add office" and have
  // not POSTed yet. Distinguishes new-unsaved from existing-edited.
  isNew?: boolean;
};

const toDraft = (o: Office): DraftOffice => ({
  id: o.id,
  name: o.name,
  address: o.address ?? "",
  latitude: o.latitude != null ? String(o.latitude) : "",
  longitude: o.longitude != null ? String(o.longitude) : "",
  radiusM: String(o.radiusM ?? 200),
  isActive: o.isActive,
  dirty: false,
});

export function OfficesTab({ companyId }: { companyId?: string }) {
  const [drafts, setDrafts] = useState<DraftOffice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [locatingId, setLocatingId] = useState<string | null>(null);

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const rows = await api.listOffices(companyId);
      setDrafts(rows.map((r) => toDraft(mapOffice(r))));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load offices");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [companyId]);

  if (!companyId) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface-muted/40 p-6 text-center text-sm text-muted-foreground">
        Save the company first, then add offices here. Each office becomes
        a geofence option employees can be assigned to in People.
      </div>
    );
  }

  const patch = (idx: number, field: keyof DraftOffice, value: any) => {
    setDrafts((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value, dirty: true };
      return next;
    });
  };

  const addRow = () => {
    setDrafts((prev) => [
      ...prev,
      {
        name: "", address: "", latitude: "", longitude: "",
        radiusM: "200", isActive: true, dirty: true, isNew: true,
      },
    ]);
  };

  const removeRow = (idx: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  };

  const useCurrentLocation = (idx: number) => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation not available in this browser");
      return;
    }
    const tempId = drafts[idx].id ?? `new-${idx}`;
    setLocatingId(tempId);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocatingId(null);
        patch(idx, "latitude", pos.coords.latitude.toFixed(7));
        patch(idx, "longitude", pos.coords.longitude.toFixed(7));
        toast.success("Picked up your current location");
      },
      (err) => {
        setLocatingId(null);
        toast.error(`Couldn't read location: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const save = async (idx: number) => {
    const d = drafts[idx];
    if (!d.name.trim()) { toast.error("Office name is required"); return; }
    const lat = d.latitude.trim() ? Number(d.latitude) : null;
    const lng = d.longitude.trim() ? Number(d.longitude) : null;
    if ((lat == null) !== (lng == null)) {
      toast.error("Set both latitude and longitude, or leave both blank");
      return;
    }
    if (lat != null && (lat < -90 || lat > 90)) { toast.error("Latitude must be in [-90, 90]"); return; }
    if (lng != null && (lng < -180 || lng > 180)) { toast.error("Longitude must be in [-180, 180]"); return; }
    const radiusM = Number(d.radiusM) || 200;
    if (radiusM <= 0 || radiusM > 10000) {
      toast.error("Radius must be 1..10000 metres");
      return;
    }
    const busyKey = d.id ?? `new-${idx}`;
    setBusyId(busyKey);
    try {
      const payload = {
        name: d.name.trim(),
        address: d.address.trim() || null,
        latitude: lat,
        longitude: lng,
        radius_m: radiusM,
      };
      if (d.id) {
        await api.updateOffice(d.id, payload);
        toast.success(`Updated "${d.name}"`);
      } else {
        await api.createOffice(companyId, payload);
        toast.success(`Added "${d.name}"`);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save office");
    } finally {
      setBusyId(null);
    }
  };

  const deactivate = async (idx: number) => {
    const d = drafts[idx];
    if (!d.id) {
      removeRow(idx);
      return;
    }
    if (!window.confirm(`Deactivate office "${d.name}"? Employees assigned to it can be moved later in People.`)) return;
    setBusyId(d.id);
    try {
      await api.deactivateOffice(d.id);
      toast.success(`Deactivated "${d.name}"`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't deactivate");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Offices show up in People as an optional dropdown after the company is picked.
          Setting a latitude/longitude turns on the geofence check at check-in (soft warn only — never blocks).
        </p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" /> Add office
        </Button>
      </div>

      {loading && drafts.length === 0 && (
        <div className="flex items-center justify-center p-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {!loading && drafts.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-surface-muted/40 p-6 text-center text-sm text-muted-foreground">
          No offices yet. Click <b>Add office</b> to create the first one.
        </div>
      )}

      <ul className="space-y-2">
        {drafts.map((d, idx) => {
          const busyKey = d.id ?? `new-${idx}`;
          const busy = busyId === busyKey;
          const locating = locatingId === (d.id ?? `new-${idx}`);
          return (
            <li
              key={d.id ?? `new-${idx}`}
              className={`rounded-md border p-3 ${d.isActive ? "border-border bg-surface" : "border-border bg-surface-muted/50"}`}
            >
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px]">Name</Label>
                  <Input value={d.name} onChange={(e) => patch(idx, "name", e.target.value)} placeholder="HQ / Hyderabad / Branch 2" className="mt-1 h-8" />
                </div>
                <div>
                  <Label className="text-[11px]">Address (optional)</Label>
                  <Input value={d.address} onChange={(e) => patch(idx, "address", e.target.value)} placeholder="Plot 22, Madhapur, Hyderabad" className="mt-1 h-8" />
                </div>
                <div>
                  <Label className="text-[11px]">Latitude</Label>
                  <Input value={d.latitude} onChange={(e) => patch(idx, "latitude", e.target.value)} placeholder="17.4399" className="mt-1 h-8" inputMode="decimal" />
                </div>
                <div>
                  <Label className="text-[11px]">Longitude</Label>
                  <Input value={d.longitude} onChange={(e) => patch(idx, "longitude", e.target.value)} placeholder="78.3489" className="mt-1 h-8" inputMode="decimal" />
                </div>
                <div>
                  <Label className="text-[11px]">Radius (metres)</Label>
                  <Input value={d.radiusM} onChange={(e) => patch(idx, "radiusM", e.target.value)} placeholder="200" className="mt-1 h-8" inputMode="numeric" />
                </div>
                <div className="flex items-end gap-1.5">
                  <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5"
                          onClick={() => useCurrentLocation(idx)} disabled={locating}>
                    {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                    Use my location
                  </Button>
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {!d.isActive && <span className="text-warning">Inactive · </span>}
                  {d.latitude && d.longitude
                    ? <>Geofence on ({d.radiusM || 200}m radius)</>
                    : <>Geofence off — no lat/lng set</>}
                </p>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 gap-1.5"
                          onClick={() => deactivate(idx)} disabled={busy}>
                    {d.isNew ? <X className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
                    {d.isNew ? "Discard" : "Deactivate"}
                  </Button>
                  <Button size="sm" className="h-7 gap-1.5" onClick={() => save(idx)} disabled={busy || !d.dirty}>
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    {d.isNew ? "Add" : "Save"}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
