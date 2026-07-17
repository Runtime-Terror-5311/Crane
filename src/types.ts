/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface CraneTelemetry {
  _id?: string; // MongoDB Document ID
  craneId: string; // Crane Identifier (e.g., CRANE-01)
  ct: number; // Crab Travel (Trolley Travel position)
  lt: number; // Long Travel (Gantry position)
  mh: number; // Main Hoist level/state
  ah: number; // Aux Hoist level/state
  mainWeight: number; // Main Hoist Weight load (tons)
  auxWeight: number; // Aux Hoist Weight load (tons)
  state?: string; // Computed crane state: "IDLE" | "OPERATING" | "OVERLOAD"
  operatingHours?: number; // Cumulative operating hours
  timestamp: string; // ISO String timestamp
  deviceTimestamp?: string | null; // Optional device NTP timestamp
  serverTimestamp?: string; // Server generation timestamp
  [key: string]: any; // Allow arbitrary keys
}

export interface AppConfig {
  mongodbConnected: boolean;
  databaseName: string;
  serverUrl: string;
  wsUrl?: string; // WebSocket connection URL
  mongoConnectionError?: string;
}

export interface CraneStats {
  craneId: string;
  operatingHours: number;
  totalPackets: number;
  maxMainWeight: number;
  maxAuxWeight: number;
  lastActiveTimestamp: string | null;
  lastState: string;
}
