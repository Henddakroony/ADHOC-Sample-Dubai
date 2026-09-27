export interface Outlet {
  id: string;
  name: string;
  district: string;
  region: string;
  governorate: string;
  channel: string;
  outletType: string;
  segmentation: string;
  status: "Active" | "Inactive" | "Pending";
  address: string;
  lat: number;
  lng: number;
  phone?: string;
  photoLink?: string;
  matchingStatus?: string;
}

export interface FilterState {
  district: string;
  region: string;
  governorate: string;
  channel: string;
  outletType: string;
  segmentation: string;
  matchingStatus: string;
  searchQuery: string;
}

export interface OutletFieldMap {
  oid: string;
  name?: string;
  district?: string;
  region?: string;
  gov?: string;
  channel?: string;
  outletType?: string;
  segmentation?: string;
  status?: string;
  address?: string;
  phone?: string;
  photoLink?: string;
  matchingStatus?: string;
}
