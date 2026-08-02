import { useMemo, useRef, useState } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldData from "world-atlas/countries-110m.json";
import * as exifr from "exifr";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleAlert, Crosshair, ImagePlus, LoaderCircle, LocateFixed, MapPin, Minus, Plus, UploadCloud, X } from "lucide-react";
import { apiFetch } from "./api";

type PreparedPhoto = { id: string; file: File; preview: string; latitude: number | null; longitude: number | null; capturedAt: string | null; status: "ready" | "uploading" | "done" | "error" };
type PlaceDraft = { name: string; country: string; latitude: number | null; longitude: number | null };
type PickerView = { scale: number; x: number; y: number };

const topology = worldData as unknown as Topology<{ countries: GeometryCollection }>;
const countries = feature(topology, topology.objects.countries) as unknown as FeatureCollection<Geometry>;

async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let latitude: number | null = null;
  let longitude: number | null = null;
  let capturedAt: string | null = null;
  try {
    const [gps, metadata] = await Promise.all([exifr.gps(file), exifr.parse(file, ["DateTimeOriginal", "CreateDate"])]);
    latitude = typeof gps?.latitude === "number" ? gps.latitude : null;
    longitude = typeof gps?.longitude === "number" ? gps.longitude : null;
    const date = metadata?.DateTimeOriginal ?? metadata?.CreateDate;
    if (date instanceof Date && !Number.isNaN(date.getTime())) capturedAt = date.toISOString();
  } catch { /* Photos without readable metadata use the picker. */ }
  let uploadFile = file;
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    try {
      const heic2any = (await import("heic2any")).default;
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: .9 });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      uploadFile = new File([blob], file.name.replace(/\.hei[cf]$/i, ".jpg"), { type: "image/jpeg" });
    } catch { /* The API can accept the original HEIC if conversion is unavailable. */ }
  }
  return { id: crypto.randomUUID(), file: uploadFile, preview: URL.createObjectURL(uploadFile), latitude, longitude, capturedAt, status: "ready" };
}

function LocationPicker({ value, onPick }: { value: PlaceDraft; onPick: (latitude: number, longitude: number) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [view, setView] = useState<PickerView>({ scale: 1, x: 0, y: 0 });
  const projection = useMemo(() => geoNaturalEarth1().fitExtent([[22, 18], [778, 382]], { type: "Sphere" }), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const pin = value.latitude !== null && value.longitude !== null ? projection([value.longitude, value.latitude]) : null;
  const zoom = (factor: number) => setView((current) => ({ ...current, scale: Math.max(1, Math.min(6, current.scale * factor)) }));
  const choose = (clientX: number, clientY: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const coordinate = projection.invert?.([(((clientX - rect.left) / rect.width) * 800 - view.x) / view.scale, (((clientY - rect.top) / rect.height) * 400 - view.y) / view.scale]);
    if (!coordinate) return;
    const [longitude, latitude] = coordinate;
    if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) onPick(latitude, longitude);
  };
  return <div className="place-map-wrap"><svg ref={svgRef} className="place-map" viewBox="0 0 800 400" role="application" aria-label="Drag and zoom, then tap to set the photo location" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { px: event.clientX, py: event.clientY, ox: view.x, oy: view.y, moved: false }; }} onPointerMove={(event) => { const drag = dragRef.current; if (!drag || !svgRef.current) return; const rect = svgRef.current.getBoundingClientRect(); const dx = (event.clientX - drag.px) / rect.width * 800; const dy = (event.clientY - drag.py) / rect.height * 400; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; setView((current) => ({ ...current, x: drag.ox + dx, y: drag.oy + dy })); }} onPointerUp={(event) => { const moved = dragRef.current?.moved; dragRef.current = null; if (!moved) choose(event.clientX, event.clientY); }} onPointerCancel={() => { dragRef.current = null; }}><rect width="800" height="400" className="place-map-ocean" /><g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}><path d={path(geoGraticule10()) ?? undefined} className="place-map-grid" />{countries.features.map((country, index) => <path d={path(country) ?? undefined} className="place-map-country" key={index} />)}{pin && <g className="place-map-pin" transform={`translate(${pin[0]} ${pin[1]}) scale(${1 / view.scale})`}><circle r="14" /><circle r="5" /></g>}</g></svg><div className="place-map-tools"><button type="button" onClick={() => zoom(1.5)}><Plus size={16} /></button><button type="button" onClick={() => zoom(1 / 1.5)}><Minus size={16} /></button><button type="button" onClick={() => setView({ scale: 1, x: 0, y: 0 })}><Crosshair size={16} /></button></div><div className="place-map-hint">{pin ? <><MapPin size={14} />Pin set · {value.latitude?.toFixed(3)}°, {value.longitude?.toFixed(3)}°</> : <><LocateFixed size={14} />Drag, zoom, then tap the location</>}</div></div>;
}

export default function MobileUploader({ token }: { token: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [places, setPlaces] = useState<Record<string, PlaceDraft>>({});
  const [activeMissingId, setActiveMissingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  const missingPhotos = useMemo(() => photos.filter((photo) => photo.latitude === null || photo.longitude === null), [photos]);
  const activeMissing = missingPhotos.find((photo) => photo.id === activeMissingId) ?? missingPhotos[0];
  const activeIndex = activeMissing ? missingPhotos.findIndex((photo) => photo.id === activeMissing.id) : -1;
  const placeIsComplete = (photo: PreparedPhoto) => photo.latitude !== null && photo.longitude !== null || Boolean(places[photo.id]?.name && places[photo.id]?.latitude !== null && places[photo.id]?.longitude !== null);

  const addFiles = async (files: FileList) => {
    const candidates = [...files].filter((file) => file.type.startsWith("image/") || /\.hei[cf]$/i.test(file.name)).slice(0, 30 - photos.length);
    if (!candidates.length) return;
    setBusy(true); setError("");
    const prepared = await Promise.all(candidates.map(preparePhoto));
    setPhotos((current) => [...current, ...prepared]);
    const missing = prepared.filter((photo) => photo.latitude === null || photo.longitude === null);
    if (missing.length) {
      setPlaces((current) => { const next = { ...current }; for (const photo of missing) next[photo.id] = { name: "", country: "", latitude: null, longitude: null }; return next; });
      setActiveMissingId((current) => current ?? missing[0].id);
    }
    setBusy(false);
  };

  const remove = (id: string) => { setPhotos((current) => { const target = current.find((photo) => photo.id === id); if (target) URL.revokeObjectURL(target.preview); return current.filter((photo) => photo.id !== id); }); setPlaces((current) => { const next = { ...current }; delete next[id]; return next; }); };
  const updatePlace = (id: string, patch: Partial<PlaceDraft>) => setPlaces((current) => ({ ...current, [id]: { ...(current[id] ?? { name: "", country: "", latitude: null, longitude: null }), ...patch } }));

  const upload = async () => {
    if (!photos.length) return;
    const incomplete = photos.find((photo) => !placeIsComplete(photo));
    if (incomplete) { setActiveMissingId(incomplete.id); setError("Place every photograph without GPS on the map and add a place name."); return; }
    setBusy(true); setError("");
    for (const photo of photos) {
      setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, status: "uploading" } : item));
      const place = places[photo.id];
      const form = new FormData();
      form.set("token", token); form.set("photo", photo.file); form.set("latitude", String(photo.latitude ?? place.latitude)); form.set("longitude", String(photo.longitude ?? place.longitude)); form.set("city", photo.latitude !== null ? "From photo GPS" : place.name); form.set("country", place?.country ?? ""); if (photo.capturedAt) form.set("capturedAt", photo.capturedAt); if (caption.trim()) form.set("caption", caption.trim());
      try { const response = await apiFetch("/api/upload", { method: "POST", body: form }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Upload failed"); setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, status: "done" } : item)); }
      catch (cause) { setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, status: "error" } : item)); setError(cause instanceof Error ? cause.message : "Upload failed"); setBusy(false); return; }
    }
    setBusy(false); setFinished(true);
  };

  if (finished) return <main className="upload-page"><header className="upload-head"><a href={import.meta.env.BASE_URL}><ArrowLeft />Atlas</a><span>YIXU’S PHOTOGRAPHY ATLAS</span></header><section className="upload-shell success"><div><Check size={36} /></div><h1>Photographs<br />placed.</h1><p>Your atlas has been updated. You can close this page or return to the map.</p><a href={import.meta.env.BASE_URL}>Return to the atlas</a></section></main>;

  return <main className="upload-page"><header className="upload-head"><a href={import.meta.env.BASE_URL}><ArrowLeft />Atlas</a><span>YIXU’S PHOTOGRAPHY ATLAS</span><i>PRIVATE TRANSFER</i></header><section className="upload-shell"><div className="intro"><small>FROM YOUR CAMERA ROLL</small><h1>Place a moment<br />on the map.</h1><p>Choose photographs from Photos. Embedded GPS and capture dates stay attached; missing locations can be placed by hand.</p></div><div className={`drop ${photos.length ? "filled" : ""}`} onClick={() => !photos.length && inputRef.current?.click()}><input ref={inputRef} type="file" accept="image/*,.heic,.heif" multiple onChange={(event) => event.target.files && void addFiles(event.target.files)} />{!photos.length ? <div className="empty">{busy ? <LoaderCircle className="spin" /> : <ImagePlus />}<h2>{busy ? "Reading photographs…" : "Choose photographs"}</h2><p>JPEG · PNG · HEIC · up to 30 at a time</p></div> : <div className="review"><div className="review-top"><b>{photos.length} photograph{photos.length === 1 ? "" : "s"}</b><button onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}><Plus />Add more</button></div><div className="thumbs">{photos.map((photo) => <article key={photo.id}><img src={photo.preview} alt="" /><button onClick={() => remove(photo.id)}><X /></button>{photo.status === "done" && <span><Check /></span>}<i>{photo.latitude === null ? "Needs place" : "GPS found"}</i></article>)}</div></div>}</div>
    {activeMissing && <section className="manual-location-card"><div className="location-card-heading"><div><span>PLACE THIS PHOTOGRAPH</span><h2>{activeIndex + 1} of {missingPhotos.length} without GPS</h2><p>Each photograph can have a different location.</p></div><div className="location-photo-chip"><img src={activeMissing.preview} alt="Selected photograph" />{placeIsComplete(activeMissing) && <Check size={16} />}</div></div><LocationPicker value={places[activeMissing.id]} onPick={(latitude, longitude) => updatePlace(activeMissing.id, { latitude, longitude })} /><div className="place-label-fields"><label>Address or place name<input value={places[activeMissing.id]?.name ?? ""} onChange={(event) => updatePlace(activeMissing.id, { name: event.target.value })} placeholder="e.g. Gion, Kyoto" /></label><label>Country / region<input value={places[activeMissing.id]?.country ?? ""} onChange={(event) => updatePlace(activeMissing.id, { country: event.target.value })} placeholder="Japan" /></label></div><div className="location-pagination"><button disabled={activeIndex <= 0} onClick={() => setActiveMissingId(missingPhotos[activeIndex - 1]?.id)}><ChevronLeft />Previous</button><div className="location-progress">{missingPhotos.map((photo) => <button className={`${photo.id === activeMissing.id ? "active" : ""} ${placeIsComplete(photo) ? "complete" : ""}`} key={photo.id} onClick={() => setActiveMissingId(photo.id)} aria-label={`Place photo ${missingPhotos.indexOf(photo) + 1}`} />)}</div><button disabled={activeIndex >= missingPhotos.length - 1} onClick={() => setActiveMissingId(missingPhotos[activeIndex + 1]?.id)}>Next<ChevronRight /></button></div></section>}
    {photos.length > 0 && <section className="caption-card"><h2><span>2</span>A shared note</h2><p>Optional · applied to this upload</p><textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Light, weather, a memory…" /></section>}{error && <div className="upload-error"><CircleAlert />{error}</div>}{photos.length > 0 && <button className="upload-button" disabled={busy} onClick={() => void upload()}>{busy ? <LoaderCircle className="spin" /> : <UploadCloud />}{busy ? "Uploading…" : `Add ${photos.length} to the atlas`}</button>}
  </section></main>;
}
