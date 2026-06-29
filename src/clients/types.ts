// === Discogs API Response Types ===

export interface DiscogsPagination {
  per_page: number;
  items: number;
  page: number;
  pages: number;
  urls?: { next?: string; last?: string; first?: string; prev?: string };
}

export interface DiscogsArtist {
  id: number;
  name: string;
  role?: string;
  resource_url?: string;
}

export interface DiscogsFormat {
  name: string; // "Vinyl", "CD", "Cassette", etc.
  qty: string;
  descriptions?: string[]; // ["LP", "Album", "Stereo", "180 Gram"]
}

export interface DiscogsLabel {
  id: number;
  name: string;
  catno: string;
  resource_url?: string;
}

export interface DiscogsImage {
  type: "primary" | "secondary";
  uri: string;
  width: number;
  height: number;
}

export interface DiscogsTrack {
  position: string;
  title: string;
  duration: string;
}

export interface DiscogsIdentifier {
  type: string; // "Matrix / Runout", "Barcode", "Mastering SID Code", ...
  value: string;
  description?: string;
}

export interface DiscogsCredit {
  id?: number;
  name: string;
  role: string; // "Mastered By", "Lacquer Cut By", "Engineer", ...
}

export interface DiscogsCompany {
  id?: number;
  name: string;
  entity_type_name?: string; // "Pressed By", "Mastered At", "Lacquer Cut At", ...
}

export interface DiscogsCommunity {
  rating: { average: number; count: number };
  have: number;
  want: number;
}

export interface DiscogsRelease {
  id: number;
  title: string;
  artists: DiscogsArtist[];
  year: number;
  master_id?: number;
  master_url?: string;
  formats: DiscogsFormat[];
  genres: string[];
  styles?: string[];
  labels: DiscogsLabel[];
  country?: string;
  released?: string;
  notes?: string;
  tracklist: DiscogsTrack[];
  images?: DiscogsImage[];
  community?: DiscogsCommunity;
  identifiers?: DiscogsIdentifier[];
  extraartists?: DiscogsCredit[];
  companies?: DiscogsCompany[];
  num_for_sale?: number;
  lowest_price?: number;
  resource_url: string;
}

export interface DiscogsMaster {
  id: number;
  title: string;
  artists: DiscogsArtist[];
  year: number;
  genres: string[];
  styles?: string[];
  tracklist: DiscogsTrack[];
  images?: DiscogsImage[];
  main_release: number;
  main_release_url: string;
  most_recent_release?: number;
  most_recent_release_url?: string;
  versions_url: string;
  num_for_sale?: number;
  lowest_price?: number;
  resource_url: string;
}

export interface DiscogsMasterVersion {
  id: number;
  title: string;
  label: string;
  catno: string;
  country: string;
  released: string;
  format: string; // Comma-separated: "Vinyl, LP, Album, Mono"
  major_formats?: string[];
  status?: string;
  resource_url: string;
  stats?: {
    community?: { in_collection: number; in_wantlist: number };
  };
  thumb?: string;
}

export interface DiscogsMasterVersionsResponse {
  pagination: DiscogsPagination;
  versions: DiscogsMasterVersion[];
}

export interface DiscogsBasicInformation {
  id: number;
  title: string;
  year: number;
  artists: DiscogsArtist[];
  labels?: DiscogsLabel[];
  formats: DiscogsFormat[];
  genres: string[];
  styles?: string[];
  thumb?: string;
  cover_image?: string;
}

export interface DiscogsCollectionItem {
  id: number;
  instance_id: number;
  folder_id: number;
  rating: number;
  date_added: string;
  basic_information: DiscogsBasicInformation;
}

export interface DiscogsCollectionResponse {
  pagination: DiscogsPagination;
  releases: DiscogsCollectionItem[];
}

export interface DiscogsWantlistItem {
  id: number;
  rating: number;
  date_added: string;
  basic_information: DiscogsBasicInformation;
}

export interface DiscogsWantlistResponse {
  pagination: DiscogsPagination;
  wants: DiscogsWantlistItem[];
}

export interface DiscogsSearchResult {
  id: number;
  type: "release" | "master" | "artist" | "label";
  title: string;
  year?: string;
  country?: string;
  format?: string[];
  label?: string[];
  genre?: string[];
  style?: string[];
  resource_url: string;
  master_id?: number;
  master_url?: string;
  thumb?: string;
  cover_image?: string;
  community?: { have: number; want: number };
}

export interface DiscogsSearchResponse {
  pagination: DiscogsPagination;
  results: DiscogsSearchResult[];
}

export interface DiscogsUserProfile {
  id: number;
  username: string;
  name?: string;
  location?: string;
  profile?: string;
  num_collection?: number;
  num_wantlist?: number;
  resource_url: string;
}

export interface DiscogsIdentity {
  id: number;
  username: string;
  resource_url: string;
  consumer_name?: string;
}
