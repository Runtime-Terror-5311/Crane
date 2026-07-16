/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { 
  Wifi, 
  WifiOff, 
  Database, 
  Cpu, 
  Trash2, 
  Send, 
  FileJson, 
  Check, 
  Copy, 
  AlertCircle, 
  Clock, 
  Sliders, 
  Activity,
  Layers,
  Search,
  RefreshCw,
  BarChart3,
  TrendingUp,
  Gauge,
  Calendar
} from "lucide-react";
import { 
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, LineChart, Line, AreaChart, Area
} from "recharts";
import { CraneTelemetry, AppConfig, CraneStats } from "./types";

const formatDuration = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
};

const getLocalDateString = (dateObj: Date) => {
  const year = dateObj.getUTCFullYear();
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getCraneLimits = (craneId: string) => {
  if (craneId === "D4") {
    return { mainLimit: 63000, auxLimit: 10000 };
  }
  return { mainLimit: 73000, auxLimit: 73000 };
};

const fetchJsonWithRetry = async (url: string, options?: RequestInit, retries = 5, delay = 1000): Promise<any> => {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Server response is not valid JSON.");
    }
    return await response.json();
  } catch (error: any) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchJsonWithRetry(url, options, retries - 1, delay * 1.5);
    }
    throw error;
  }
};

export default function App() {
  // Telemetry list
  const [telemetry, setTelemetry] = useState<CraneTelemetry[]>([]);
  const [activeTab, setActiveTab] = useState<"dashboard" | "graphs">("dashboard");
  const [selectedItem, setSelectedItem] = useState<CraneTelemetry | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [craneStats, setCraneStats] = useState<CraneStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);
  const [filterCraneId, setFilterCraneId] = useState("All");
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return getLocalDateString(new Date());
  });
  
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);
  
  // Table view filter states
  const [displayLimit, setDisplayLimit] = useState<number>(100);
  const [startTimeFilter, setStartTimeFilter] = useState<string>("00:00");
  const [endTimeFilter, setEndTimeFilter] = useState<string>("23:59");

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Simulation test payload state
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testPayload, setTestPayload] = useState<string>(
    JSON.stringify({
      craneId: "D4",
      ct: 10,
      lt: 45,
      mh: 2,
      ah: 1,
      mainWeight: 1400,
      auxWeight: 0,
      deviceTimestamp: "2026-07-02T18:45:12"
    }, null, 2)
  );
  const [testSendSuccess, setTestSendSuccess] = useState(false);

  // Active item to show in detail (selected or latest matching filter, or just latest)
  const activeTelemetry: CraneTelemetry | null = (() => {
    if (selectedItem) return selectedItem;
    const filtered = telemetry.filter(t => filterCraneId === "All" || t.craneId === filterCraneId);
    return filtered[0] || telemetry[0] || null;
  })();

  // Fetch telemetry logs (supports filtering by date on the backend)
  const fetchLogs = async (silent = false, dateToFetch = selectedDate) => {
    if (!silent) setLoading(true);
    try {
      const url = dateToFetch ? `/api/crane?date=${dateToFetch}` : "/api/crane";
      const data = await fetchJsonWithRetry(url, {}, 5, 1000);
      setTelemetry(data);
      setError(null);
    } catch (err: any) {
      console.warn("Telemetry fetch failed after retries:", err);
      setError("Unable to reach the backend telemetry server. Please make sure the server is starting up correctly.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Fetch config details
  const fetchConfig = async () => {
    try {
      const data = await fetchJsonWithRetry("/api/config", {}, 5, 1000);
      setConfig(data);
    } catch (err) {
      console.warn("Failed to load server configuration details after retries:", err);
    }
  };

  // Fetch cumulative stats
  const fetchStats = async () => {
    try {
      const data = await fetchJsonWithRetry("/api/crane/stats", {}, 5, 1000);
      setCraneStats(data);
    } catch (err: any) {
      console.warn("Failed to fetch fleet stats after retries:", err);
    }
  };

  // Socket.io connection setup and initial load
  useEffect(() => {
    fetchConfig();
    fetchStats();

    // Determine the initial selected date on load
    const initTelemetry = async () => {
      try {
        setLoading(true);
        const data = await fetchJsonWithRetry("/api/crane", {}, 5, 1000);
        if (data && data.length > 0) {
          const latestDate = getLocalDateString(new Date(data[0].timestamp));
          setSelectedDate(latestDate);
        } else {
          await fetchLogs(false, selectedDate);
        }
      } catch (err) {
        console.warn("Initial telemetry load failed after retries, falling back to today", err);
        await fetchLogs(false, selectedDate);
      } finally {
        setLoading(false);
      }
    };

    initTelemetry();

    // Establish Socket.io connection using current host, forcing direct WebSocket transport
    // to bypass the stateful HTTP long-polling stage, which fails behind stateless reverse proxies.
    const socket = io(window.location.origin, {
      path: "/socket.io",
      transports: ["websocket"],
      upgrade: false,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    socket.on("connect", () => {
      console.log("Socket.io telemetry stream established successfully!");
      setWsConnected(true);
      setError(null);
    });

    socket.on("initial_history", (history: CraneTelemetry[]) => {
      if (history && history.length > 0) {
        setTelemetry((prev) => prev.length === 0 ? history : prev);
      }
    });

    socket.on("initial_stats", (stats: CraneStats[]) => {
      if (stats) setCraneStats(stats);
    });

    socket.on("telemetry_update", (message: { data: CraneTelemetry; stats?: CraneStats[] }) => {
      const newTelemetry = message.data;
      const packetDateStr = getLocalDateString(new Date(newTelemetry.timestamp));
      const currentSelectedDate = selectedDateRef.current;

      if (currentSelectedDate && packetDateStr > currentSelectedDate) {
        // Auto-switch to the new date so we can see the live incoming stream
        setSelectedDate(packetDateStr);
        setTelemetry((prev) => {
          if (prev.some(t => t.timestamp === newTelemetry.timestamp && t.craneId === newTelemetry.craneId)) {
            return prev;
          }
          return [newTelemetry, ...prev];
        });
      } else {
        setTelemetry((prev) => {
          // Prevent duplicates
          if (prev.some(t => t.timestamp === newTelemetry.timestamp && t.craneId === newTelemetry.craneId)) {
            return prev;
          }
          
          // If the user is currently viewing a specific date, and the incoming packet is not for that date,
          // do not add it to the active telemetry dataset.
          if (currentSelectedDate && packetDateStr !== currentSelectedDate) {
            return prev;
          }

          return [newTelemetry, ...prev];
        });
      }

      if (message.stats) {
        setCraneStats(message.stats);
      }
    });

    socket.on("telemetry_cleared", () => {
      setTelemetry([]);
      setCraneStats([]);
      setSelectedItem(null);
    });

    socket.on("disconnect", (reason) => {
      console.warn("Socket.io link disconnected. Reason:", reason);
      setWsConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.warn("Socket.io connect_error:", err);
      setWsConnected(false);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Fetch telemetry logs whenever the selected date changes
  useEffect(() => {
    if (selectedDate) {
      fetchLogs(true, selectedDate);
    }
  }, [selectedDate]);

  // Polling fallback if Socket.io is offline
  useEffect(() => {
    let pollTimer: NodeJS.Timeout | null = null;
    if (!wsConnected && selectedDate) {
      pollTimer = setInterval(async () => {
        try {
          // 1. Check if there's any newer telemetry in the database first (e.g. uploaded via REST or LoRa)
          const latestData = await fetchJsonWithRetry("/api/crane?limit=1", {}, 1, 500);
          if (latestData && latestData.length > 0) {
            const latestDateInDb = getLocalDateString(new Date(latestData[0].timestamp));
            if (latestDateInDb > selectedDate) {
              // A newer date has been uploaded! Switch to it.
              setSelectedDate(latestDateInDb);
              return; // The selectedDate change will trigger fetchLogs for the new date automatically
            }
          }
          
          // 2. Standard polling updates for the currently selected date
          await fetchLogs(true, selectedDate);
          await fetchStats();
        } catch (err) {
          console.warn("Polling interval failed to refresh telemetry:", err);
        }
      }, 4000);
    }
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [wsConnected, selectedDate]);

  // Send a simulated POST packet to the ingestion server
  const handleSendSimulatedPacket = async () => {
    setIsSendingTest(true);
    setTestSendSuccess(false);
    setActionError(null);
    try {
      let parsedJson;
      try {
        parsedJson = JSON.parse(testPayload);
      } catch (jsonErr) {
        setActionError("Invalid JSON format in simulated payload.");
        setIsSendingTest(false);
        return;
      }

      // Add a dynamic timestamp if not present (and not simulating deviceTimestamp)
      if (!parsedJson.timestamp && !parsedJson.deviceTimestamp) {
        parsedJson.timestamp = new Date().toISOString();
      }

      const response = await fetch("/api/crane", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(parsedJson)
      });

      if (response.ok) {
        setTestSendSuccess(true);
        setTimeout(() => setTestSendSuccess(false), 3000);

        const resData = await response.json().catch(() => ({}));
        if (resData && resData.data && resData.data.timestamp) {
          const newPacketDate = getLocalDateString(new Date(resData.data.timestamp));
          if (newPacketDate > selectedDate) {
            setSelectedDate(newPacketDate);
          } else {
            await fetchLogs(true, selectedDate);
            await fetchStats();
          }
        } else {
          await fetchLogs(true, selectedDate);
          await fetchStats();
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        setActionError(errData.error || "Server returned error when processing simulation packet.");
      }
    } catch (err) {
      console.error("Failed to post simulation packet:", err);
      setActionError("Error sending simulation packet.");
    } finally {
      setIsSendingTest(false);
    }
  };

  // Clear database logs
  const handleClearLogs = async () => {
    setActionError(null);
    if (!showClearConfirm) {
      setShowClearConfirm(true);
      return;
    }

    try {
      const response = await fetch("/api/crane/clear", { method: "DELETE" });
      if (response.ok) {
        setTelemetry([]);
        setCraneStats([]);
        setSelectedItem(null);
        setShowClearConfirm(false);
      } else {
        setActionError("Failed to clear database logs from MongoDB.");
        setShowClearConfirm(false);
      }
    } catch (err) {
      console.error(err);
      setActionError("Error clearing logs.");
      setShowClearConfirm(false);
    }
  };

  // Copy code/JSON to clipboard
  const handleCopyCode = (codeText: string) => {
    navigator.clipboard.writeText(codeText);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  // Filter list of cranes based on selection
  const uniqueCraneIds = ["All", ...Array.from(new Set(telemetry.map(t => t.craneId)))];
  craneStats.forEach(stat => {
    if (!uniqueCraneIds.includes(stat.craneId)) {
      uniqueCraneIds.push(stat.craneId);
    }
  });

  // Filter and format telemetry data for the displayed feed
  const filteredTelemetry = (() => {
    let result = [...telemetry];
    
    // 1. Crane ID filter
    if (filterCraneId !== "All") {
      result = result.filter(t => t.craneId === filterCraneId);
    }
    
    // 2. Date filter (double check)
    if (selectedDate) {
      result = result.filter(t => {
        const dStr = getLocalDateString(new Date(t.timestamp));
        return dStr === selectedDate;
      });
    }
    
    // 3. Clock duration filter (start & end hour range)
    if (startTimeFilter || endTimeFilter) {
      result = result.filter(t => {
        const itemDate = new Date(t.timestamp);
        const hours = itemDate.getHours();
        const minutes = itemDate.getMinutes();
        const timeVal = hours * 60 + minutes; // total minutes from start of day
        
        let startVal = 0;
        if (startTimeFilter) {
          const [sh, sm] = startTimeFilter.split(":").map(Number);
          startVal = sh * 60 + sm;
        }
        
        let endVal = 24 * 60;
        if (endTimeFilter) {
          const [eh, em] = endTimeFilter.split(":").map(Number);
          endVal = eh * 60 + em;
        }
        
        return timeVal >= startVal && timeVal <= endVal;
      });
    }
    
    // 4. Sort descending (newest first)
    result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // 5. Slice to display limit
    return result.slice(0, displayLimit);
  })();

  // Operational times calculations
  const operationalStats = (() => {
    const craneLogs = [...telemetry]
      .filter(t => filterCraneId === "All" || t.craneId === filterCraneId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let totalOperatingSec = 0;
    let workingWithLoadSec = 0;
    let workingWithoutLoadSec = 0;
    let standstillWithLoadSec = 0;
    let totalIdleSec = 0;

    for (let i = 0; i < craneLogs.length; i++) {
      const item = craneLogs[i];
      let gap = 5; // default 5 seconds per packet if it's the last one or single packet
      if (i < craneLogs.length - 1) {
        const nextTime = new Date(craneLogs[i + 1].timestamp).getTime();
        const currTime = new Date(item.timestamp).getTime();
        const diff = (nextTime - currTime) / 1000;
        if (diff > 0 && diff < 300) {
          gap = diff;
        }
      }

      const mainWeight = item.mainWeight ?? 0;
      const auxWeight = item.auxWeight ?? 0;
      const hasLoad = mainWeight > 10 || auxWeight > 10;
      const isMoving = (item.lt ?? 0) > 0 || (item.ct ?? 0) > 0 || (item.mh ?? 0) > 0 || (item.ah ?? 0) > 0;

      if (isMoving && hasLoad) {
        workingWithLoadSec += gap;
        totalOperatingSec += gap;
      } else if (isMoving && !hasLoad) {
        workingWithoutLoadSec += gap;
        totalOperatingSec += gap;
      } else if (!isMoving && hasLoad) {
        standstillWithLoadSec += gap;
        totalOperatingSec += gap;
      } else {
        totalIdleSec += gap;
      }
    }

    const totalSec = totalOperatingSec + totalIdleSec;

    return {
      totalOperatingSec,
      workingWithLoadSec,
      workingWithoutLoadSec,
      standstillWithLoadSec,
      totalIdleSec,
      totalSec
    };
  })();

  // Daily Hourly Operational stats for the selected date
  const dailyHourlyStats = (() => {
    // Filter telemetry by active crane and selected date
    const dayLogs = [...telemetry]
      .filter(t => filterCraneId === "All" || t.craneId === filterCraneId)
      .filter(t => {
        const dStr = getLocalDateString(new Date(t.timestamp));
        return dStr === selectedDate;
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Initialize hourly operating time in seconds for 24 hours
    const hourlySeconds = Array(24).fill(0);

    for (let i = 0; i < dayLogs.length; i++) {
      const item = dayLogs[i];
      let gap = 5;
      if (i < dayLogs.length - 1) {
        const nextTime = new Date(dayLogs[i + 1].timestamp).getTime();
        const currTime = new Date(item.timestamp).getTime();
        const diff = (nextTime - currTime) / 1000;
        if (diff > 0 && diff < 300) {
          gap = diff;
        }
      }

      const mainWeight = item.mainWeight ?? 0;
      const auxWeight = item.auxWeight ?? 0;
      const hasLoad = mainWeight > 50 || auxWeight > 50;
      const isMoving = (item.lt ?? 0) > 0 || (item.ct ?? 0) > 0 || (item.mh ?? 0) > 0 || (item.ah ?? 0) > 0;

      // Operating / Working time consists of: working with load, working without load, and standstill with load
      const isOperating = (isMoving && hasLoad) || (isMoving && !hasLoad) || (!isMoving && hasLoad);

      if (isOperating) {
        const hour = new Date(item.timestamp).getHours();
        if (hour >= 0 && hour < 24) {
          hourlySeconds[hour] += gap;
        }
      }
    }

    // Convert seconds to hours with decimal format
    return hourlySeconds.map((secs, idx) => {
      const label = `${String(idx).padStart(2, "0")}:00`;
      const hoursVal = parseFloat((secs / 3600).toFixed(3)); // convert to hours
      return {
        hour: label,
        operatingHours: hoursVal,
        seconds: secs
      };
    });
  })();

  const totalDailyOperatingSec = dailyHourlyStats.reduce((acc, curr) => acc + curr.seconds, 0);

  return (
    <div id="root-container" className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* GLOBAL BANNER ERROR */}
      {error && (
        <div className="bg-red-900/80 border-b border-red-500 text-red-100 px-6 py-2.5 text-xs font-semibold flex items-center gap-2 animate-pulse">
          <AlertCircle className="w-4.5 h-4.5" />
          <span>{error} Make sure your backend server is running and accessible on port 3000.</span>
          <button onClick={() => fetchLogs()} className="ml-auto text-xs underline hover:no-underline font-mono">Retry Connect</button>
        </div>
      )}

      {/* OVERLOAD WARNING ALERT */}
      {(() => {
        // Find the latest packet for each crane to check current real-time state
        const latestPacketsByCrane: { [craneId: string]: CraneTelemetry } = {};
        for (const t of telemetry) {
          if (!latestPacketsByCrane[t.craneId]) {
            latestPacketsByCrane[t.craneId] = t;
          } else {
            const existingTime = new Date(latestPacketsByCrane[t.craneId].timestamp).getTime();
            const currTime = new Date(t.timestamp).getTime();
            if (currTime > existingTime) {
              latestPacketsByCrane[t.craneId] = t;
            }
          }
        }

        const overloadedCranes = Object.values(latestPacketsByCrane).filter(t => {
          const { mainLimit, auxLimit } = getCraneLimits(t.craneId);
          return (t.mainWeight ?? 0) > mainLimit || (t.auxWeight ?? 0) > auxLimit;
        });

        if (overloadedCranes.length === 0) return null;
        
        // Sort by timestamp descending
        overloadedCranes.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const latestOverload = overloadedCranes[0];
        const { mainLimit, auxLimit } = getCraneLimits(latestOverload.craneId);
        const exceedingWeight = Math.max(latestOverload.mainWeight ?? 0, latestOverload.auxWeight ?? 0);
        const isMainOverload = (latestOverload.mainWeight ?? 0) > mainLimit;
        const activeLimit = isMainOverload ? mainLimit : auxLimit;
        const hoistType = isMainOverload ? "Main Hoist" : "Aux Hoist";

        return (
          <div className="bg-red-600 border-b border-red-500 text-white px-6 py-3 text-xs font-bold flex items-center gap-3 animate-pulse shadow-lg shrink-0">
            <AlertCircle className="w-5 h-5 shrink-0 text-white animate-bounce" />
            <div className="flex-1">
              <span className="uppercase tracking-wider font-black">CRITICAL CAPACITY OVERLOAD ALERT:</span> Crane <span className="underline font-mono">{latestOverload.craneId}</span> has exceeded {hoistType} safety limit of {activeLimit.toLocaleString()} kg! Measured Load: <span className="font-mono text-sm underline">{exceedingWeight.toLocaleString()} kg</span>.
            </div>
            <span className="text-[10px] bg-red-800 px-2 py-0.5 rounded font-mono font-bold">
              {new Date(latestOverload.timestamp).toLocaleTimeString()}
            </span>
          </div>
        );
      })()}

      {/* HEADER SECTION */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600/10 p-2 rounded-lg border border-indigo-500/20">
            <Cpu className="w-6 h-6 text-indigo-400 animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white font-mono flex items-center gap-2">
              ESP32 LoRa Live Telemetry Stream
            </h1>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Real-time ingestion inspector. Keep track of incoming data packets instantly via Socket.io.
            </p>
          </div>
        </div>

        {/* CONNECTION, STORAGE & TOTAL WORKING TIME INDICATORS */}
        <div className="flex flex-wrap items-center gap-4 text-[11px]">
          {/* Top Total Operating Time Widget */}
          <div className="bg-gradient-to-r from-indigo-950/80 to-slate-900 border border-indigo-500/30 px-3.5 py-1.5 rounded-lg flex items-center gap-2.5 shadow-sm font-mono">
            <Clock className="w-4.5 h-4.5 text-indigo-400 animate-pulse" />
            <div>
              <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-wider block leading-none mb-0.5">TOTAL OPERATING TIME</span>
              <span className="text-xs font-black text-white font-mono tracking-tight leading-none">
                {formatDuration(operationalStats.totalOperatingSec)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 font-mono">
            <div className={`px-2.5 py-1.5 rounded-full border flex items-center gap-1.5 font-bold transition-all ${
              wsConnected 
                ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-400" 
                : "bg-amber-950/40 border-amber-500/40 text-amber-400"
            }`}>
              {wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5 animate-pulse" />}
              <span>Socket.io: {wsConnected ? "CONNECTED" : "FALLBACK POLLING"}</span>
            </div>

            <div className={`px-2.5 py-1.5 rounded-full border flex items-center gap-1.5 font-bold ${
              config?.mongodbConnected
                ? "bg-indigo-950/40 border-indigo-500/40 text-indigo-300"
                : "bg-slate-900 border-slate-800 text-slate-400"
            }`}>
              <Database className="w-3.5 h-3.5" />
              <span>DB: {config?.mongodbConnected ? `MongoDB (${config.databaseName})` : "Local In-Memory"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* SUB-HEADER TAB BAR */}
      <div className="bg-slate-900 border-b border-slate-800/80 px-6 py-2 flex items-center gap-4 shrink-0 font-mono text-xs">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-bold transition-all cursor-pointer ${
            activeTab === "dashboard"
              ? "bg-indigo-600 border-indigo-500 text-white shadow-md"
              : "bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-200"
          }`}
        >
          <Sliders className="w-4 h-4" />
          Dashboard & Live Logs
        </button>
        <button
          onClick={() => setActiveTab("graphs")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-bold transition-all cursor-pointer ${
            activeTab === "graphs"
              ? "bg-indigo-600 border-indigo-500 text-white shadow-md"
              : "bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-200"
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Operational Analytics Graphs
        </button>
      </div>

      {/* MAIN LAYOUT SPLIT */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        
        {activeTab === "dashboard" ? (
          <>
            {/* LEFT PANEL: PACKET LOG STREAM */}
            <section className="flex-1 lg:max-w-[55%] border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col overflow-hidden">
              
              {actionError && (
                <div className="bg-red-950/80 border-b border-red-500/40 text-red-200 px-4 py-2.5 text-[11px] font-mono flex items-center justify-between gap-2 shrink-0 animate-fade-in">
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{actionError}</span>
                  </span>
                  <button onClick={() => setActionError(null)} className="text-[10px] uppercase text-red-400 hover:text-red-300 font-bold ml-2">Dismiss</button>
                </div>
              )}

              {/* TELEMETRY FEED LIST */}
              <div className="flex-1 flex flex-col overflow-hidden">
                
                {/* Table Header Filter controls */}
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 shrink-0">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4.5 h-4.5 text-indigo-400" />
                    <h2 className="text-xs font-bold uppercase tracking-widest text-white font-mono">Incoming Telemetry Feed</h2>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">Filter ID:</span>
                      <select 
                        value={filterCraneId} 
                        onChange={(e) => setFilterCraneId(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-indigo-300 focus:outline-none focus:border-indigo-500"
                      >
                        {uniqueCraneIds.map(cid => (
                          <option key={cid} value={cid}>{cid}</option>
                        ))}
                      </select>
                    </div>
                    {telemetry.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        {showClearConfirm ? (
                          <>
                            <button 
                              onClick={() => setShowClearConfirm(false)}
                              className="text-[10px] text-slate-400 hover:text-slate-300 font-bold transition px-2 py-1 border border-slate-700 bg-slate-900 rounded"
                            >
                              Cancel
                            </button>
                            <button 
                              onClick={handleClearLogs}
                              className="text-[10px] text-white bg-red-600 hover:bg-red-500 font-bold transition flex items-center gap-1 border border-red-500 px-2.5 py-1 rounded animate-pulse cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Confirm Clear?
                            </button>
                          </>
                        ) : (
                          <button 
                            onClick={handleClearLogs}
                            className="text-[11px] text-red-400 hover:text-red-300 transition flex items-center gap-0.5 border border-red-500/20 px-2 py-1 bg-red-950/20 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Clear All
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* ADVANCED FILTER TOOLBAR */}
                <div className="px-4 py-3 bg-slate-950 border-b border-slate-900/60 flex flex-wrap items-center gap-4 text-xs font-mono shrink-0">
                  {/* Calendar Date Picker */}
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Date:</span>
                    <div className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-800/80 px-2.5 py-1.5 rounded-md text-indigo-300">
                      <Calendar className="w-3.5 h-3.5" />
                      <input 
                        type="date" 
                        value={selectedDate} 
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="bg-transparent text-[11px] font-bold text-indigo-300 focus:outline-none cursor-pointer [color-scheme:dark]"
                      />
                    </div>
                  </div>

                  {/* Clock Duration (Hours Range) */}
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Clock Duration:</span>
                    <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800/80 px-2 py-1 rounded-md text-indigo-300">
                      <input 
                        type="time" 
                        value={startTimeFilter} 
                        onChange={(e) => setStartTimeFilter(e.target.value)}
                        className="bg-transparent text-[11px] font-bold text-indigo-300 focus:outline-none cursor-pointer [color-scheme:dark] w-14"
                      />
                      <span className="text-slate-600 font-bold">to</span>
                      <input 
                        type="time" 
                        value={endTimeFilter} 
                        onChange={(e) => setEndTimeFilter(e.target.value)}
                        className="bg-transparent text-[11px] font-bold text-indigo-300 focus:outline-none cursor-pointer [color-scheme:dark] w-14"
                      />
                    </div>
                  </div>

                  {/* Display Limit Selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Show:</span>
                    <select 
                      value={displayLimit} 
                      onChange={(e) => setDisplayLimit(Number(e.target.value))}
                      className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-[11px] font-bold text-indigo-300 focus:outline-none focus:border-indigo-500"
                    >
                      <option value={100}>Top 100</option>
                      <option value={500}>Top 500</option>
                      <option value={10000}>All Records</option>
                    </select>
                  </div>

                  {/* Reset Filters / Record Count */}
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-[10px] text-slate-500 font-bold">
                      Showing {filteredTelemetry.length} of {telemetry.length} packets
                    </span>
                    {(startTimeFilter !== "00:00" || endTimeFilter !== "23:59" || displayLimit !== 100) && (
                      <button 
                        onClick={() => {
                          setStartTimeFilter("00:00");
                          setEndTimeFilter("23:59");
                          setDisplayLimit(100);
                        }}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-bold cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    )}
                  </div>
                </div>

                {/* LIVE FEED TABLE - LIMITED TO ABOUT 10 ENTRIES MAX HEIGHT WITH INTERNAL SCROLL */}
                <div className="max-h-[460px] overflow-y-auto bg-slate-950 border border-slate-900 rounded-lg flex-1">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800 bg-slate-900/10">
                        <th className="p-3 pl-4">Time Received</th>
                        <th className="p-3">Device / Node ID</th>
                        <th className="p-3">State</th>
                        <th className="p-3 text-right">LT</th>
                        <th className="p-3 text-right">CT</th>
                        <th className="p-3 text-right">MH</th>
                        <th className="p-3 text-right">AH</th>
                        <th className="p-3 text-right">MHW</th>
                        <th className="p-3 text-right pr-4">AHW</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-[11px] divide-y divide-slate-800/40">
                      {loading && telemetry.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="p-12 text-center text-slate-400">
                            <div className="flex flex-col items-center gap-2">
                              <RefreshCw className="w-6 h-6 text-indigo-500 animate-spin" />
                              <span>Awaiting telemetry data streams...</span>
                            </div>
                          </td>
                        </tr>
                      ) : filteredTelemetry.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="p-12 text-center text-slate-500">
                            No telemetry logs matching filter found.
                          </td>
                        </tr>
                      ) : (
                        filteredTelemetry.map((item, index) => {
                          // Check if this item is active
                          const isSelected = activeTelemetry 
                            ? activeTelemetry.timestamp === item.timestamp && activeTelemetry.craneId === item.craneId 
                            : index === 0;

                          // Display badges for states
                          let stateBadgeClass = "bg-slate-900 text-slate-400 border border-slate-800";
                          const { mainLimit: itemMainLimit, auxLimit: itemAuxLimit } = getCraneLimits(item.craneId);
                          const isOverloaded = (item.mainWeight ?? 0) > itemMainLimit || (item.auxWeight ?? 0) > itemAuxLimit;
                          
                          if (item.state === "OVERLOAD" || isOverloaded) {
                            stateBadgeClass = "bg-red-950 text-red-400 border border-red-800 font-extrabold animate-pulse";
                          } else if (item.state === "OPERATING") {
                            stateBadgeClass = "bg-indigo-950 text-indigo-300 border border-indigo-800/40 font-bold";
                          }

                          return (
                            <tr
                              key={`${item.craneId}-${item.timestamp}-${index}`}
                              onClick={() => setSelectedItem(item)}
                              className={`cursor-pointer transition-all border-b border-slate-900 ${
                                isSelected 
                                  ? "bg-indigo-950/30 text-indigo-200 border-l-4 border-l-indigo-500" 
                                  : "hover:bg-slate-900/40 text-slate-300 border-l-4 border-l-transparent"
                              }`}
                            >
                              {/* TIME COLUMN */}
                              <td className="p-3 pl-4 text-slate-400 font-medium whitespace-nowrap">
                                {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                                <span className="text-[9px] text-slate-600 block">
                                  {new Date(item.timestamp).toLocaleDateString([], { month: '2-digit', day: '2-digit' })}
                                </span>
                              </td>

                              {/* DEVICE ID COLUMN */}
                              <td className="p-3 font-bold text-white whitespace-nowrap">
                                <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 font-bold">
                                  {item.craneId}
                                </span>
                              </td>

                              {/* STATE COLUMN */}
                              <td className="p-3 whitespace-nowrap">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${stateBadgeClass}`}>
                                  {isOverloaded ? "OVERLOAD" : (item.state || "IDLE")}
                                </span>
                              </td>

                              {/* LT COLUMN */}
                              <td className="p-3 text-right text-slate-300 whitespace-nowrap">
                                {item.lt ?? 0}
                              </td>

                              {/* CT COLUMN */}
                              <td className="p-3 text-right text-slate-300 whitespace-nowrap">
                                {item.ct ?? 0}
                              </td>

                              {/* MH COLUMN */}
                              <td className="p-3 text-right text-slate-300 whitespace-nowrap">
                                {item.mh ?? 0}
                              </td>

                              {/* AH COLUMN */}
                              <td className="p-3 text-right text-slate-300 whitespace-nowrap">
                                {item.ah ?? 0}
                              </td>

                              {/* MHW (Main Hoist Weight) COLUMN */}
                              <td className={`p-3 text-right font-bold whitespace-nowrap ${ (item.mainWeight ?? 0) > itemMainLimit ? "text-red-400" : "text-emerald-400" }`}>
                                {item.mainWeight ?? 0} kg
                              </td>

                              {/* AHW (Aux Hoist Weight) COLUMN */}
                              <td className={`p-3 text-right pr-4 font-bold whitespace-nowrap ${ (item.auxWeight ?? 0) > itemAuxLimit ? "text-red-400" : "text-emerald-400" }`}>
                                {item.auxWeight ?? 0} kg
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* TOTAL PACKETS SUMMARY BAR */}
                <div className="bg-slate-900 px-4 py-2 border-t border-slate-800 text-[10px] text-slate-500 font-mono uppercase tracking-wider flex justify-between shrink-0">
                  <span>Telemetry Count: {telemetry.length} Ingested Packets</span>
                  <span className="animate-pulse flex items-center gap-1 text-indigo-400 font-bold">
                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                    Socket.io Pipeline Active
                  </span>
                </div>

              </div>

            </section>

            {/* RIGHT PANEL: SIMPLIFIED OPERATIONAL TIMES ANALYSIS */}
            <section className="flex-1 bg-slate-950 p-6 flex flex-col gap-6 overflow-y-auto">
              
              <div className="border-b border-slate-800 pb-4 flex justify-between items-center">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-400 font-mono flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-indigo-400" />
                    Operational Times Analysis
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed mt-1">
                    {filterCraneId === "All" 
                      ? "Combined operational diagnostics for all monitored cranes in real-time."
                      : `Real-time state and timing analysis for Crane ${filterCraneId}.`
                    }
                  </p>
                </div>
                <div className="text-[10px] font-mono bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-md text-slate-400">
                  Active Crane: <span className="text-white font-bold">{filterCraneId}</span>
                </div>
              </div>

              <div className="flex flex-col gap-6">
                
                {/* TOTAL OPERATING TIME CARD */}
                <div className="bg-gradient-to-r from-indigo-950/60 to-slate-900 border border-indigo-500/20 p-5 rounded-xl shadow-lg relative overflow-hidden">
                  <div className="absolute right-4 top-4 text-indigo-500/10 pointer-events-none">
                    <Activity className="w-24 h-24" />
                  </div>
                  <span className="text-[10px] text-indigo-400 font-mono uppercase font-extrabold tracking-wider block mb-1">Total Operating Time</span>
                  <span className="text-3xl font-black text-white font-mono tracking-tight block">
                    {formatDuration(operationalStats.totalOperatingSec)}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-1 font-mono">
                    Accumulated time while crane was active (moving or carrying a load).
                  </p>
                </div>

                {/* DETAILED OPERATING STATE TIMES */}
                <div>
                  <h3 className="text-xs font-bold uppercase text-slate-500 font-mono mb-3 tracking-wider flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-slate-500" />
                    State Metrics Breakdown
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    
                    {/* WORKING WITH LOAD */}
                    <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-xl font-mono hover:bg-slate-900/60 transition">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Working With Load</span>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm"></span>
                      </div>
                      <span className="text-xl font-bold text-white block">
                        {formatDuration(operationalStats.workingWithLoadSec)}
                      </span>
                      <p className="text-[9px] text-slate-500 mt-1 leading-normal">
                        Crane is moving while a load is actively suspended (&gt;50 kg).
                      </p>
                    </div>

                    {/* WORKING WITHOUT LOAD */}
                    <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-xl font-mono hover:bg-slate-900/60 transition">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-sky-400 font-bold uppercase tracking-wider">Working Without Load</span>
                        <span className="w-2 h-2 rounded-full bg-sky-500 shadow-sm"></span>
                      </div>
                      <span className="text-xl font-bold text-white block">
                        {formatDuration(operationalStats.workingWithoutLoadSec)}
                      </span>
                      <p className="text-[9px] text-slate-500 mt-1 leading-normal">
                        Crane is moving under no load condition (hook empty, &lt;=50 kg).
                      </p>
                    </div>

                    {/* STANDSTILL WITH LOAD */}
                    <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-xl font-mono hover:bg-slate-900/60 transition">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Standstill With Load</span>
                        <span className="w-2 h-2 rounded-full bg-amber-500 shadow-sm"></span>
                      </div>
                      <span className="text-xl font-bold text-white block">
                        {formatDuration(operationalStats.standstillWithLoadSec)}
                      </span>
                      <p className="text-[9px] text-slate-500 mt-1 leading-normal">
                        Load is suspended (&gt;50 kg) but no gantry or trolley movement is detected.
                      </p>
                    </div>

                    {/* TOTAL IDLE TIME */}
                    <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-xl font-mono hover:bg-slate-900/60 transition">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Idle Time</span>
                        <span className="w-2 h-2 rounded-full bg-slate-500 shadow-sm"></span>
                      </div>
                      <span className="text-xl font-bold text-white block">
                        {formatDuration(operationalStats.totalIdleSec)}
                      </span>
                      <p className="text-[9px] text-slate-500 mt-1 leading-normal">
                        Crane is stationary with no active load suspended (&lt;=50 kg).
                      </p>
                    </div>

                  </div>
                </div>

              </div>

            </section>
          </>
        ) : (
          /* GRAPHS VIEW: DEDICATED REAL-TIME ANALYTICS PAGE */
          <section className="flex-1 bg-slate-950 p-6 flex flex-col gap-6 overflow-y-auto">
            
            {/* GRAPHS TOP FILTER & HEADER BAR */}
            <div className="border-b border-slate-800 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-400 font-mono flex items-center gap-1.5">
                  <BarChart3 className="w-5 h-5 text-indigo-400" />
                  Fleet Operational Diagnostics Graphs
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed mt-1">
                  Graphical metrics plotting total operating time, duty cycle breakdown, and lift weight trend vectors.
                </p>
              </div>

              <div className="flex items-center gap-3 font-mono text-[11px] bg-slate-900/60 border border-slate-800 p-2 rounded-lg self-start md:self-auto">
                <span className="text-slate-400 font-bold">Select Diagnostic Crane:</span>
                <select 
                  value={filterCraneId} 
                  onChange={(e) => setFilterCraneId(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-[11px] text-indigo-300 font-bold focus:outline-none focus:border-indigo-500"
                >
                  {uniqueCraneIds.map(cid => (
                    <option key={cid} value={cid}>{cid}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* GRAPHS TIMING SUMMARY QUICK CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
              <div className="bg-slate-900/40 border border-slate-800/80 p-3.5 rounded-xl font-mono">
                <span className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Total Operating Time</span>
                <span className="text-base font-black text-white">{formatDuration(operationalStats.totalOperatingSec)}</span>
              </div>
              <div className="bg-slate-900/40 border border-slate-800/80 p-3.5 rounded-xl font-mono">
                <span className="text-[9px] text-emerald-400 font-bold uppercase block mb-1">Working With Load</span>
                <span className="text-base font-black text-emerald-300">{formatDuration(operationalStats.workingWithLoadSec)}</span>
              </div>
              <div className="bg-slate-900/40 border border-slate-800/80 p-3.5 rounded-xl font-mono">
                <span className="text-[9px] text-sky-400 font-bold uppercase block mb-1">Working Without Load</span>
                <span className="text-base font-black text-sky-300">{formatDuration(operationalStats.workingWithoutLoadSec)}</span>
              </div>
              <div className="bg-slate-900/40 border border-slate-800/80 p-3.5 rounded-xl font-mono">
                <span className="text-[9px] text-amber-400 font-bold uppercase block mb-1">Standstill With Load</span>
                <span className="text-base font-black text-amber-300">{formatDuration(operationalStats.standstillWithLoadSec)}</span>
              </div>
              <div className="bg-slate-900/40 border border-slate-800/80 p-3.5 rounded-xl font-mono">
                <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Total Idle Time</span>
                <span className="text-base font-black text-slate-300">{formatDuration(operationalStats.totalIdleSec)}</span>
              </div>
            </div>

            {/* CHARTS BENTO GRID */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              
              {/* CHART 1: DAILY OPERATIONAL PROFILE */}
              <div className="bg-slate-900/40 border border-slate-800 p-5 rounded-xl flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/60 pb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase text-white font-mono flex items-center gap-1.5">
                      <BarChart3 className="w-4 h-4 text-indigo-400" />
                      Daily Operating Profile
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Total operating time on <span className="text-indigo-300 font-bold font-mono">{selectedDate}</span> is <span className="text-indigo-300 font-bold font-mono">{formatDuration(totalDailyOperatingSec)}</span>.
                    </p>
                  </div>
                  
                  {/* Calendar view selection on the right top */}
                  <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-2.5 py-1.5 shrink-0 rounded-md">
                    <Calendar className="w-4 h-4 text-indigo-400" />
                    <input 
                      type="date" 
                      value={selectedDate} 
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="bg-transparent text-[11px] font-bold text-indigo-300 focus:outline-none cursor-pointer [color-scheme:dark]"
                    />
                  </div>
                </div>

                <div className="h-72 w-full mt-2">
                  {totalDailyOperatingSec > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart 
                        data={dailyHourlyStats} 
                        margin={{ top: 10, right: 10, left: -10, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="hour" stroke="#64748b" fontSize={9} fontStyle="bold" />
                        <YAxis 
                          stroke="#64748b" 
                          fontSize={9} 
                          tickFormatter={(value) => `${value}h`}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                          itemStyle={{ color: '#f8fafc' }}
                          labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                          formatter={(value: any) => [`${value} hrs (${formatDuration(Math.round(Number(value) * 3600))})`, 'Working Time']}
                        />
                        <Bar dataKey="operatingHours" fill="#6366f1" radius={[4, 4, 0, 0]}>
                          {dailyHourlyStats.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={entry.operatingHours > 0 ? "#6366f1" : "#1e293b"} 
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-500 font-mono text-xs border border-dashed border-slate-800/80 rounded-lg bg-slate-950/20">
                      <Calendar className="w-7 h-7 text-slate-700 animate-pulse" />
                      <span>No operating logs found for {selectedDate}</span>
                      <p className="text-[10px] text-slate-600">Select another day or stream incoming packets</p>
                    </div>
                  )}
                </div>
              </div>

              {/* CHART 2: PIE CHART SHARE */}
              <div className="bg-slate-900/40 border border-slate-800 p-5 rounded-xl flex flex-col gap-4">
                <div>
                  <h3 className="text-xs font-bold uppercase text-white font-mono flex items-center gap-1.5">
                    <Gauge className="w-4 h-4 text-indigo-400" />
                    Duty Cycle Percentage Share (%)
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Relative proportion of time allocated across gantry and lifting activities.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-6 mt-2">
                  <div className="h-56 w-56 relative shrink-0">
                    {operationalStats.totalSec > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: "Working W/ Load", seconds: operationalStats.workingWithLoadSec, color: "#10b981" },
                              { name: "Working W/O Load", seconds: operationalStats.workingWithoutLoadSec, color: "#0ea5e9" },
                              { name: "Standstill W/ Load", seconds: operationalStats.standstillWithLoadSec, color: "#f59e0b" },
                              { name: "Total Idle Time", seconds: operationalStats.totalIdleSec, color: "#64748b" }
                            ].filter(d => d.seconds > 0)}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={75}
                            paddingAngle={4}
                            dataKey="seconds"
                          >
                            {[
                              { name: "Working W/ Load", seconds: operationalStats.workingWithLoadSec, color: "#10b981" },
                              { name: "Working W/O Load", seconds: operationalStats.workingWithoutLoadSec, color: "#0ea5e9" },
                              { name: "Standstill W/ Load", seconds: operationalStats.standstillWithLoadSec, color: "#f59e0b" },
                              { name: "Total Idle Time", seconds: operationalStats.totalIdleSec, color: "#64748b" }
                            ].filter(d => d.seconds > 0).map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                            formatter={(value: any) => [`${value} s (${formatDuration(Number(value))})`, 'Duration']}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-slate-600">
                        No active logs
                      </div>
                    )}
                  </div>

                  <div className="flex-1 w-full flex flex-col gap-2 font-mono text-[10px]">
                    {[
                      { name: "Working W/ Load", seconds: operationalStats.workingWithLoadSec, color: "#10b981" },
                      { name: "Working W/O Load", seconds: operationalStats.workingWithoutLoadSec, color: "#0ea5e9" },
                      { name: "Standstill W/ Load", seconds: operationalStats.standstillWithLoadSec, color: "#f59e0b" },
                      { name: "Total Idle Time", seconds: operationalStats.totalIdleSec, color: "#64748b" }
                    ].map((item, idx) => {
                      const percentage = operationalStats.totalSec > 0 
                        ? Math.round((item.seconds / operationalStats.totalSec) * 100) 
                        : 0;
                      return (
                        <div key={idx} className="flex items-center justify-between border-b border-slate-800/40 pb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                            <span className="text-slate-400">{item.name}</span>
                          </div>
                          <span className="text-white font-bold">{formatDuration(item.seconds)} ({percentage}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* CHART 3: WEIGHT TREND WITH SAFETY OVERLOAD REFERENCE */}
              <div className="bg-slate-900/40 border border-slate-800 p-5 rounded-xl flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xs font-bold uppercase text-white font-mono flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-indigo-400" />
                      Hoist Lifting Weight Profile & Thresholds
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Rolling real-time plot of hoist weights with crane-specific safety thresholds (D4: Main 63k / Aux 10k; Others: 73k).
                    </p>
                  </div>
                  {telemetry.some(t => {
                    const { mainLimit, auxLimit } = getCraneLimits(t.craneId);
                    return (t.mainWeight ?? 0) > mainLimit || (t.auxWeight ?? 0) > auxLimit;
                  }) && (
                    <span className="bg-red-950 text-red-400 border border-red-800 text-[9px] px-2 py-0.5 rounded font-mono font-bold animate-pulse uppercase">
                      Overload Events Detected
                    </span>
                  )}
                </div>

                <div className="h-72 w-full mt-2">
                  {telemetry.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart 
                        data={[...filteredTelemetry]
                          .slice(0, 40)
                          .reverse()
                          .map(t => {
                            const { mainLimit, auxLimit } = getCraneLimits(t.craneId);
                            return {
                              time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                              mhw: t.mainWeight ?? 0,
                              ahw: t.auxWeight ?? 0,
                              mainLimit,
                              auxLimit
                            };
                          })}
                        margin={{ top: 10, right: 10, left: -10, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={9} />
                        <YAxis stroke="#64748b" fontSize={9} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                          itemStyle={{ color: '#f8fafc' }}
                          labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                          formatter={(value: any) => [`${value.toLocaleString()} kg`, 'Weight']}
                        />
                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px', fontFamily: 'monospace' }} />
                        <Line type="monotone" dataKey="mhw" name="Main Hoist Weight" stroke="#10b981" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
                        <Line type="monotone" dataKey="ahw" name="Aux Hoist Weight" stroke="#38bdf8" strokeWidth={1} dot={{ r: 1.5 }} />
                        <Line type="monotone" dataKey="mainLimit" name="Main Hoist Safety Limit" stroke="#ef4444" strokeDasharray="5 5" strokeWidth={1.5} dot={false} activeDot={false} />
                        <Line type="monotone" dataKey="auxLimit" name="Aux Hoist Safety Limit" stroke="#f97316" strokeDasharray="3 3" strokeWidth={1.5} dot={false} activeDot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center font-mono text-[10px] text-slate-600">
                      Awaiting packet stream logs...
                    </div>
                  )}
                </div>
              </div>

              {/* CHART 4: POSITION TRACKING COORDINATES */}
              <div className="bg-slate-900/40 border border-slate-800 p-5 rounded-xl flex flex-col gap-4">
                <div>
                  <h3 className="text-xs font-bold uppercase text-white font-mono flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-indigo-400" />
                    Travel & Coordinates Trajectory
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Continuous monitoring of Long Travel (LT) and Cross Travel (CT) positions.
                  </p>
                </div>

                <div className="h-72 w-full mt-2">
                  {telemetry.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart 
                        data={[...filteredTelemetry]
                          .slice(0, 40)
                          .reverse()
                          .map(t => ({
                            time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                            lt: t.lt ?? 0,
                            ct: t.ct ?? 0
                          }))}
                        margin={{ top: 10, right: 10, left: -10, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={9} />
                        <YAxis stroke="#64748b" fontSize={9} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                          itemStyle={{ color: '#f8fafc' }}
                          labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                        />
                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px', fontFamily: 'monospace' }} />
                        <Area type="monotone" dataKey="lt" name="Long Travel (LT)" stroke="#6366f1" fill="#6366f1" fillOpacity={0.1} strokeWidth={1.5} />
                        <Area type="monotone" dataKey="ct" name="Cross Travel (CT)" stroke="#ec4899" fill="#ec4899" fillOpacity={0.1} strokeWidth={1.5} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center font-mono text-[10px] text-slate-600">
                      Awaiting packet stream logs...
                    </div>
                  )}
                </div>
              </div>

            </div>

          </section>
        )}

      </main>

      {/* FOOTER / STATUS BAR */}
      <footer className="h-9 bg-slate-900 border-t border-slate-800 px-6 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500 shrink-0 select-none font-mono">
        <div className="flex gap-4 items-center">
          <span>ESP32 Socket.io Inspector</span>
          <span>|</span>
          <span>No Unrequested Graphics Rendering</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <span>PORT: 3000</span>
        </div>
      </footer>

    </div>
  );
}
