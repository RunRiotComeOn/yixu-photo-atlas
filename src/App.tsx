import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldData from "world-atlas/countries-110m.json";
import QRCode from "qrcode";
import { ArrowLeft, ArrowRight, Camera, Check, Copy, Crosshair, Info, KeyRound, Minus, Plus, RefreshCw, ScanLine, Upload, X } from "lucide-react";
import { apiFetch, apiReady, apiUrl } from "./api";
import { demoPhotos } from "./demo";
import MobileUploader from "./MobileUploader";
import type { AtlasPhoto, UploadSession } from "./types";

type Place = { key: string; city: string; country: string; latitude: number; longitude: number; photos: AtlasPhoto[] };
type View = { scale: number; x: number; y: number };

const topology = worldData as unknown as Topology<{ countries: GeometryCollection }>;
const countries = feature(topology, topology.objects.countries) as unknown as FeatureCollection<Geometry>;

function placesOf(photos: AtlasPhoto[]) {
  const groups = new globalThis.Map<string, AtlasPhoto[]>();
  for (const photo of photos) {
    const key = `${photo.city}|${photo.country}|${photo.latitude.toFixed(2)}|${photo.longitude.toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), photo]);
  }
  return [...groups].map(([key, value]) => ({ key, city: value[0].city, country: value[0].country, latitude: value[0].latitude, longitude: value[0].longitude, photos: value }));
}

function Preview({ place }: { place: Place }) {
  return <div className="preview"><div className="prints">{place.photos.slice(0, 3).map((photo, index) => <div className={`print p${index}`} key={photo.id}><img src={photo.src} alt="" /></div>)}</div><div className="ticket"><b>{place.city}</b><span>{place.country}</span><small><Camera size={12} />{place.photos.length} photograph{place.photos.length === 1 ? "" : "s"}</small></div></div>;
}

function AtlasMap({ places, onOpen }: { places: Place[]; onOpen: (place: Place) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [active, setActive] = useState<string | null>(places[0]?.key ?? null);
  const [moving, setMoving] = useState(false);
  const projection = useMemo(() => geoNaturalEarth1().fitExtent([[35, 28], [965, 472]], { type: "Sphere" }), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const zoom = useCallback((next: number, point = { x: 500, y: 250 }) => setView((current) => {
    const scale = Math.max(1, Math.min(4.5, next));
    const ratio = scale / current.scale;
    return { scale, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio };
  }), []);

  return <section className="map-frame"><svg ref={svg} className={`world ${moving ? "moving" : ""}`} viewBox="0 0 1000 500" role="application" aria-label="Interactive photography map" onWheel={(event) => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); zoom(view.scale * (event.deltaY < 0 ? 1.18 : .84), { x: (event.clientX - bounds.left) / bounds.width * 1000, y: (event.clientY - bounds.top) / bounds.height * 500 }); }} onPointerDown={(event) => { if ((event.target as Element).closest(".marker")) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y }; setMoving(true); }} onPointerMove={(event) => { if (!drag.current || !svg.current) return; const bounds = svg.current.getBoundingClientRect(); setView((current) => ({ ...current, x: drag.current!.ox + (event.clientX - drag.current!.x) / bounds.width * 1000, y: drag.current!.oy + (event.clientY - drag.current!.y) / bounds.height * 500 })); }} onPointerUp={() => { drag.current = null; setMoving(false); }} onPointerCancel={() => { drag.current = null; setMoving(false); }}>
    <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}><path className="grid" d={path(geoGraticule10()) ?? undefined} />{countries.features.map((country, index) => <path className="country" d={path(country) ?? undefined} key={index} />)}
      {places.map((place) => { const point = projection([place.longitude, place.latitude]); if (!point) return null; const isActive = active === place.key; return <g className={`marker ${isActive ? "active" : ""}`} transform={`translate(${point[0]} ${point[1]}) scale(${1 / view.scale})`} key={place.key} role="button" tabIndex={0} aria-label={`${place.city}: ${place.photos.length} photographs`} onMouseEnter={() => setActive(place.key)} onFocus={() => setActive(place.key)} onClick={(event) => { event.stopPropagation(); if (isActive) onOpen(place); else setActive(place.key); }} onKeyDown={(event) => { if (event.key === "Enter") onOpen(place); }}><circle className="hit" r="23" /><circle className="halo" r="14" /><circle className="dot" r="8" />{place.photos.length > 1 && <text y="3.5">{place.photos.length}</text>}{isActive && <foreignObject x="14" y="-174" width="245" height="185"><Preview place={place} /></foreignObject>}</g>; })}
    </g>
  </svg><div className="tools"><button onClick={() => zoom(view.scale * 1.3)} aria-label="Zoom in"><Plus /></button><button onClick={() => zoom(view.scale / 1.3)} aria-label="Zoom out"><Minus /></button><button onClick={() => setView({ scale: 1, x: 0, y: 0 })} aria-label="Reset map"><Crosshair /></button></div><div className="map-help">DRAG TO EXPLORE · SCROLL TO ZOOM</div></section>;
}

function Gallery({ place, close }: { place: Place; close: () => void }) {
  const [index, setIndex] = useState(0);
  const move = useCallback((delta: number) => setIndex((current) => (current + delta + place.photos.length) % place.photos.length), [place.photos.length]);
  const photo = place.photos[index];
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === "Escape") close(); if (event.key === "ArrowLeft") move(-1); if (event.key === "ArrowRight") move(1); }; addEventListener("keydown", listener); return () => removeEventListener("keydown", listener); }, [close, move]);
  return <div className="overlay" onMouseDown={close}><div className="gallery" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={close}><X /></button><header><div><small>PLACE {String(place.photos.length).padStart(2, "0")}</small><h2>{place.city}</h2><i>{place.country}</i></div><span>{index + 1} / {place.photos.length}</span></header><div className="stage"><img src={photo.src} alt={photo.caption ?? photo.filename} />{place.photos.length > 1 && <><button className="prev" onClick={() => move(-1)}><ArrowLeft /></button><button className="next" onClick={() => move(1)}><ArrowRight /></button></>}</div><footer><i>{photo.caption ?? photo.filename}</i><span>{photo.latitude.toFixed(3)}°, {photo.longitude.toFixed(3)}°</span></footer></div></div>;
}

function QRPanel({ close }: { close: () => void }) {
  const [adminToken, setAdminToken] = useState(sessionStorage.getItem("atlas-admin-token") ?? "");
  const [session, setSession] = useState<UploadSession | null>(null);
  const [qr, setQr] = useState("");
  const [left, setLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!adminToken.trim()) { setError("Enter your private upload key first."); return; }
    setLoading(true); setError("");
    try {
      const response = await apiFetch("/api/upload-session", { method: "POST", headers: { Authorization: `Bearer ${adminToken.trim()}` } });
      const body = await response.json() as UploadSession & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not create upload link");
      sessionStorage.setItem("atlas-admin-token", adminToken.trim());
      setSession(body);
      setQr(await QRCode.toDataURL(body.uploadUrl, { width: 250, margin: 1, color: { dark: "#25271f", light: "#faf5e8" } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unavailable"); } finally { setLoading(false); }
  }, [adminToken]);

  useEffect(() => { const timer = setInterval(() => { if (!session) return; const remaining = Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)); setLeft(remaining); if (remaining === 0 && !loading) void refresh(); }, 1000); return () => clearInterval(timer); }, [session, loading, refresh]);

  return <div className="overlay" onMouseDown={close}><aside className="panel" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={close}><X /></button><small>MOBILE TRANSFER</small><h2>Add photographs<br />from your iPhone</h2><p>Unlock a short-lived QR code, then choose images from Photos. GPS and capture dates are read on your phone.</p>{!session && <label className="secret-field"><span><KeyRound size={14} /> Private upload key</span><input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Stored only for this browser tab" onKeyDown={(event) => { if (event.key === "Enter") void refresh(); }} /></label>}<div className="qr">{qr ? <img src={qr} alt="Mobile upload QR code" /> : <ScanLine />}{loading && <RefreshCw className="spin" />}</div>{error ? <p className="err">{error}</p> : session && <div className="status"><span>● Refreshes in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span><button onClick={() => void refresh()}><RefreshCw />Refresh</button></div>}<button className="copy" onClick={() => session ? navigator.clipboard.writeText(session.uploadUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }) : void refresh()}>{session ? (copied ? <Check /> : <Copy />) : <KeyRound />}{session ? (copied ? "Copied" : "Copy upload link") : "Unlock QR code"}</button><div className="note"><Info />Each QR expires automatically. Photos without GPS pause for manual placement.</div></aside></div>;
}

export default function App() {
  const search = new URLSearchParams(location.search);
  const uploadToken = search.get("upload");
  const [photos, setPhotos] = useState<AtlasPhoto[]>(demoPhotos);
  const [demo, setDemo] = useState(true);
  const [selected, setSelected] = useState<Place | null>(null);
  const [panel, setPanel] = useState<"qr" | "about" | null>(null);

  useEffect(() => { if (!apiReady || uploadToken) return; apiFetch("/api/photos").then(async (response) => { if (!response.ok) return; const body = await response.json() as { photos: AtlasPhoto[] }; if (body.photos.length) { setPhotos(body.photos.map((photo) => ({ ...photo, src: photo.src.startsWith("http") ? photo.src : apiUrl(photo.src) }))); setDemo(false); } }).catch(() => undefined); }, [uploadToken]);
  const places = useMemo(() => placesOf(photos), [photos]);
  if (uploadToken) return <MobileUploader token={uploadToken} />;

  return <main className="atlas"><header className="top"><div className="brand"><small>ARCHIVE № 01</small><h1>Yixu’s Atlas</h1><p>A personal geography of light</p></div><div className="actions"><nav><button onClick={() => setPanel("qr")}><ScanLine />Scan to add</button><button onClick={() => setPanel("about")}>About</button></nav><span>{places.length} places · {photos.length} photographs</span></div></header><AtlasMap places={places} onOpen={setSelected} />{demo && <div className="sample"><b>{apiReady ? "Sample atlas" : "Backend setup pending"}</b> · {apiReady ? "Scan to add your photographs" : "Deploy Cloudflare to connect uploads"}</div>}<button className="mobile-add" onClick={() => setPanel("qr")}><Upload />Add photographs</button>{selected && <Gallery place={selected} close={() => setSelected(null)} />}{panel === "qr" && <QRPanel close={() => setPanel(null)} />}{panel === "about" && <div className="overlay" onMouseDown={() => setPanel(null)}><aside className="panel about" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={() => setPanel(null)}><X /></button><small>ABOUT THE ATLAS</small><h2>A personal<br />geography of light.</h2><p>Yixu’s Atlas turns photographs into a map of lived moments. Location is read from each image, so the archive grows according to where the camera has actually been.</p><hr /><dl><div><dt>Navigate</dt><dd>Drag, zoom, hover</dd></div><div><dt>Open</dt><dd>Select a blue marker</dd></div><div><dt>Add</dt><dd>Scan from an iPhone</dd></div></dl></aside></div>}</main>;
}
