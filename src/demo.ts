import type { AtlasPhoto } from "./types";

const asset = (name: string) => `${import.meta.env.BASE_URL}demo/${name}`;

export const demoPhotos: AtlasPhoto[] = [
  { id: "demo-kyoto", src: asset("kyoto.jpg"), filename: "after-rain.jpg", latitude: 35.0116, longitude: 135.7681, city: "Kyoto", country: "Japan", capturedAt: "2026-04-12T10:28:00Z", uploadedAt: "2026-04-13T08:00:00Z", caption: "After rain, Gion", demo: true },
  { id: "demo-shanghai", src: asset("shanghai.jpg"), filename: "river-haze.jpg", latitude: 31.2304, longitude: 121.4737, city: "Shanghai", country: "China", capturedAt: "2026-01-03T11:40:00Z", uploadedAt: "2026-01-04T08:00:00Z", caption: "Blue hour on the river", demo: true },
  { id: "demo-california", src: asset("california.jpg"), filename: "pacific-light.jpg", latitude: 38.429, longitude: -123.105, city: "Sonoma Coast", country: "United States", capturedAt: "2025-11-19T01:12:00Z", uploadedAt: "2025-11-20T08:00:00Z", caption: "Last light, Pacific", demo: true },
];
