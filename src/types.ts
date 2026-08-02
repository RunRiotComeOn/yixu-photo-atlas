export type AtlasPhoto = {
  id: string;
  src: string;
  filename: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  capturedAt: string | null;
  uploadedAt: string;
  caption: string | null;
  demo?: boolean;
};

export type UploadSession = {
  token: string;
  expiresAt: string;
  uploadUrl: string;
};
