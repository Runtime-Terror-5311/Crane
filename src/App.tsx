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

const getISTDateString = (dateObj: Date) => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(dateObj);
  } catch (e) {
    const year = dateObj.getUTCFullYear();
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
};

const formatISTTime = (timestamp: string | Date) => {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

const formatISTDate = (timestamp: string | Date) => {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit'
  });
};

const getISTHour = (dateObj: Date) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hour12: false
    });
    const hr = parseInt(formatter.format(dateObj), 10);
    return hr === 24 ? 0 : hr;
  } catch (e) {
    return dateObj.getUTCHours();
  }
};

const getCraneLimits = (craneId: string) => {
  return { mainLimit: 63000, auxLimit: 10000 };
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
    return getISTDateString(new Date());
  });
  
  const selectedDateRef = useRef(selectedDate);
  const userSelectedDateRef = useRef(false);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);
  
  // Table view filter states
  const [startTimeFilter, setStartTimeFilter] = useState<string>("00:00");
  const [endTimeFilter, setEndTimeFilter] = useState<string>("23:59");

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);

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
          const latestDate = getISTDateString(new Date(data[0].timestamp));
if (!userSelectedDateRef.current) {
  setSelectedDate(latestDate);
}
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

    let ws: WebSocket | null = null;
    let sse: EventSource | null = null;
    let socket: any = null;
    let wsReconnectTimeout: NodeJS.Timeout | null = null;
    let sseReconnectTimeout: NodeJS.Timeout | null = null;
    let socketReconnectTimeout: NodeJS.Timeout | null = null;
    let isDisposed = false;

    // Unified message handler
    const handleRealtimeMessage = (message: any) => {
      switch (message.type) {
        case "INITIAL_HISTORY":
          if (message.history && message.history.length > 0) {
            setTelemetry((prev) => prev.length === 0 ? message.history : prev);
          }
          break;
        case "INITIAL_STATS":
          if (message.stats) {
            setCraneStats(message.stats);
          }
          break;
        case "TELEMETRY_UPDATE": {
          const newTelemetry = message.data;
          const packetDateStr = getISTDateString(new Date(newTelemetry.timestamp));
          const currentSelectedDate = selectedDateRef.current;

          // Auto-switch to the incoming packet's date so it immediately shows on the dashboard
          if (!userSelectedDateRef.current && currentSelectedDate && packetDateStr !== currentSelectedDate) {
  setSelectedDate(packetDateStr);
}

          // Trigger a beautiful visual flash effect on the first three cells of this row
          const uniqueId = `${newTelemetry.craneId}-${newTelemetry.timestamp}`;
          setHighlightedRowId(uniqueId);
          setTimeout(() => {
            setHighlightedRowId((prev) => prev === uniqueId ? null : prev);
          }, 3000);

          setTelemetry((prev) => {
            // Prevent duplicates
            if (prev.some(t => t.timestamp === newTelemetry.timestamp && t.craneId === newTelemetry.craneId)) {
              return prev;
            }
            return [newTelemetry, ...prev];
          });

          if (message.stats) {
            setCraneStats(message.stats);
          }
          break;
        }
        case "TELEMETRY_CLEARED":
          setTelemetry([]);
          setCraneStats([]);
          setSelectedItem(null);
          break;
        default:
          break;
      }
    };

    // 1. Establish Socket.io
    const connectSocketIO = () => {
      if (isDisposed) return;
      try {
        console.log("Attempting Socket.io connection...");
        socket = io(window.location.origin, {
          path: "/socket.io",
          transports: ["websocket", "polling"],
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 20000
        });

        socket.on("connect", () => {
          console.log("Socket.io connection established successfully!");
          setWsConnected(true);
          setError(null);
        });

        socket.on("disconnect", (reason: string) => {
          console.warn("Socket.io connection disconnected:", reason);
          const isOtherConnected = (ws && ws.readyState === WebSocket.OPEN) || (sse && sse.readyState === EventSource.OPEN);
          if (!isOtherConnected) {
            setWsConnected(false);
          }
        });

        socket.on("connect_error", (err: any) => {
          console.warn("Socket.io connection error. Trying fallback...", err);
          const isOtherConnected = (ws && ws.readyState === WebSocket.OPEN) || (sse && sse.readyState === EventSource.OPEN);
          if (!isOtherConnected) {
            setWsConnected(false);
          }
        });

        socket.on("initial_history", (history: any) => {
          handleRealtimeMessage({ type: "INITIAL_HISTORY", history });
        });

        socket.on("initial_stats", (stats: any) => {
          handleRealtimeMessage({ type: "INITIAL_STATS", stats });
        });

        socket.on("telemetry_update", (payload: any) => {
          handleRealtimeMessage({ type: "TELEMETRY_UPDATE", data: payload.data, stats: payload.stats });
        });

        socket.on("telemetry_cleared", () => {
          handleRealtimeMessage({ type: "TELEMETRY_CLEARED" });
        });

      } catch (err) {
        console.error("Error setting up Socket.io connection:", err);
      }
    };

    // 2. Establish WebSocket
    const connectWebSocket = () => {
      if (isDisposed) return;
      try {
        const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${wsProtocol}//${window.location.host}/ws/telemetry`;
        console.log("Attempting native WebSocket connection to:", wsUrl);

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log("Native WebSocket telemetry stream established successfully!");
          setWsConnected(true);
          setError(null);
        };

        ws.onclose = (event) => {
          console.warn(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}. Retrying connection...`);
          const isOtherConnected = (socket && socket.connected) || (sse && sse.readyState === EventSource.OPEN);
          if (!isOtherConnected) {
            setWsConnected(false);
          }
          if (!isDisposed) {
            wsReconnectTimeout = setTimeout(connectWebSocket, 5000);
          }
        };

        ws.onerror = () => {
          console.warn("WebSocket connection error. Relying on Server-Sent Events / Socket.io / polling fallbacks...");
          const isOtherConnected = (socket && socket.connected) || (sse && sse.readyState === EventSource.OPEN);
          if (!isOtherConnected) {
            setWsConnected(false);
          }
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            handleRealtimeMessage(message);
          } catch (jsonErr) {
            console.error("Failed to parse WebSocket message:", jsonErr);
          }
        };
      } catch (connErr) {
        console.error("Error setting up WebSocket:", connErr);
        if (!isDisposed) {
          wsReconnectTimeout = setTimeout(connectWebSocket, 5000);
        }
      }
    };

    // 3. Establish Server-Sent Events (SSE)
    const connectSSE = () => {
      if (isDisposed) return;
      try {
        console.log("Attempting Server-Sent Events (SSE) stream connection...");
        sse = new EventSource("/api/telemetry/stream");

        sse.onopen = () => {
          console.log("SSE stream established successfully!");
          setWsConnected(true);
          setError(null);
        };

        sse.onerror = () => {
          console.warn("SSE connection closed or failed. Retrying SSE stream in 5s...");
          const isOtherConnected = (socket && socket.connected) || (ws && ws.readyState === WebSocket.OPEN);
          if (!isOtherConnected) {
            setWsConnected(false);
          }
          if (sse) sse.close();
          if (!isDisposed) {
            sseReconnectTimeout = setTimeout(connectSSE, 5000);
          }
        };

        sse.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            handleRealtimeMessage(message);
          } catch (jsonErr) {
            console.error("Failed to parse SSE message:", jsonErr);
          }
        };
      } catch (err) {
        console.error("Error setting up SSE stream:", err);
        if (!isDisposed) {
          sseReconnectTimeout = setTimeout(connectSSE, 5000);
        }
      }
    };

    connectSocketIO();
    connectWebSocket();
    connectSSE();

    return () => {
      isDisposed = true;
      if (ws) ws.close();
      if (sse) sse.close();
      if (socket) socket.disconnect();
      if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
      if (sseReconnectTimeout) clearTimeout(sseReconnectTimeout);
      if (socketReconnectTimeout) clearTimeout(socketReconnectTimeout);
    };
  }, []);

  // Fetch telemetry logs whenever the selected date changes
  useEffect(() => {
    if (selectedDate) {
      fetchLogs(true, selectedDate);
    }
  }, [selectedDate]);

  // Polling / Sync check to ensure 100% data alignment even if socket/SSE has transient dropouts
  useEffect(() => {
    let pollTimer: NodeJS.Timeout | null = null;
    if (selectedDate) {
      // Poll every 3 seconds if disconnected, or every 6 seconds as a background heartbeat if connected
      const intervalMs = wsConnected ? 6000 : 3000;
      pollTimer = setInterval(async () => {
        try {
          // 1. Check if there's any newer telemetry in the database first (e.g. uploaded via REST or LoRa)
          const latestData = await fetchJsonWithRetry("/api/crane?limit=1", {}, 1, 300);
          if (latestData && latestData.length > 0) {
            const latestDateInDb = getISTDateString(new Date(latestData[0].timestamp));
            if (!userSelectedDateRef.current && latestDateInDb > selectedDate) {
  setSelectedDate(latestDateInDb);
  return;
}
          }
          
          // 2. Standard polling updates for the currently selected date
          await fetchLogs(true, selectedDate);
          await fetchStats();
        } catch (err) {
          console.warn("Polling interval failed to refresh telemetry:", err);
        }
      }, intervalMs);
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
          const newPacketDate = getISTDateString(new Date(resData.data.timestamp));
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

  // Seed database logs with high-quality demo data
  const [isSeeding, setIsSeeding] = useState(false);
  const handleSeedLogs = async () => {
    setActionError(null);
    setIsSeeding(true);
    try {
      const response = await fetch("/api/crane/seed", { method: "POST" });
      if (response.ok) {
        // Refresh local state with silent flag to avoid visual flashes
        await fetchLogs(true, selectedDate);
        await fetchStats();
        setSelectedItem(null);
      } else {
        setActionError("Failed to seed database logs with demo data.");
      }
    } catch (err) {
      console.error(err);
      setActionError("Error seeding demo logs.");
    } finally {
      setIsSeeding(false);
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
        const dStr = getISTDateString(new Date(t.timestamp));
        return dStr === selectedDate;
      });
    }
    
    // 3. Clock duration filter (start & end hour range)
    if (startTimeFilter || endTimeFilter) {
      result = result.filter(t => {
        const itemDate = new Date(t.timestamp);
        let hours = itemDate.getUTCHours();
        let minutes = itemDate.getUTCMinutes();
        try {
          const hrStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(itemDate);
          const minStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', minute: 'numeric' }).format(itemDate);
          const parsedHr = parseInt(hrStr, 10);
          hours = parsedHr === 24 ? 0 : parsedHr;
          minutes = parseInt(minStr, 10);
        } catch (e) {}
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
    
    // 5. Return all records
    return result;
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
        const dStr = getISTDateString(new Date(t.timestamp));
        return dStr === selectedDate;
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Initialize hourly working and idle time in seconds for 24 hours
    const hourlyWorkingSeconds = Array(24).fill(0);
    const hourlyIdleSeconds = Array(24).fill(0);

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

      const hour = getISTHour(new Date(item.timestamp));
      if (hour >= 0 && hour < 24) {
        if (isOperating) {
          hourlyWorkingSeconds[hour] += gap;
        } else {
          hourlyIdleSeconds[hour] += gap;
        }
      }
    }

    // Convert seconds to minutes with decimal format
    return hourlyWorkingSeconds.map((workingSecs, idx) => {
      const idleSecs = hourlyIdleSeconds[idx];
      const label = `${String(idx).padStart(2, "0")}:00`;
      const workingMinutesVal = parseFloat((workingSecs / 60).toFixed(1)); // convert to minutes
      const idleMinutesVal = parseFloat((idleSecs / 60).toFixed(1)); // convert to minutes
      return {
        hour: label,
        workingMinutes: workingMinutesVal,
        idleMinutes: idleMinutesVal,
        workingSeconds: workingSecs,
        idleSeconds: idleSecs,
        totalSeconds: workingSecs + idleSecs
      };
    });
  })();

  const totalDailyOperatingSec = dailyHourlyStats.reduce((acc, curr) => acc + curr.workingSeconds, 0);
  const totalDailyIdleSec = dailyHourlyStats.reduce((acc, curr) => acc + curr.idleSeconds, 0);

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
            <span className="text-[10px] bg-red-800 px-2 py-1 rounded font-mono font-bold text-white flex flex-col items-end gap-0.5">
              <span>{formatISTTime(latestOverload.timestamp)} (IST)</span>
              <span className="text-[9px] text-red-200/80 font-normal">{new Date(latestOverload.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' })} UTC</span>
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
              <span>WebSockets: {wsConnected ? "CONNECTED" : "FALLBACK POLLING"}</span>
            </div>

            <div 
              title={config?.mongodbConnected ? `Connected to Database: ${config.databaseName}` : `Ephemeral storage active. Reason: ${config?.mongoConnectionError || 'Not connected'}`}
              className={`px-2.5 py-1.5 rounded-full border flex items-center gap-1.5 font-bold transition-all relative group cursor-help ${
                config?.mongodbConnected
                  ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-400"
                  : "bg-amber-950/30 border-amber-500/30 text-amber-500"
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>DB: {config?.mongodbConnected ? `MongoDB (${config.databaseName})` : "Local Ephemeral"}</span>
              
              {!config?.mongodbConnected && (
                <div className="absolute top-full mt-2 right-0 hidden group-hover:flex flex-col bg-slate-900 border border-slate-800 p-3 rounded-lg w-72 shadow-xl z-50 text-slate-300 font-sans font-normal leading-normal whitespace-normal">
                  <div className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1">Persistent Storage Alert</div>
                  <p className="text-[11px] mb-1.5">
                    Data is currently saved in **ephemeral server memory** and will be lost when the deployed container restarts (typical on Cloud Run scale-to-zero).
                  </p>
                  <p className="text-[11px] text-slate-400">
                    <span className="font-semibold text-white">To persist data:</span> configure the <code className="bg-slate-950 px-1 py-0.5 rounded text-indigo-400 font-mono">MONGODB_URI</code> environment variable in your deployment settings.
                  </p>
                  {config?.mongoConnectionError && (
                    <div className="mt-2 pt-1.5 border-t border-slate-800 text-[10px] text-red-400 font-mono break-all">
                      Error: {config.mongoConnectionError}
                    </div>
                  )}
                </div>
              )}
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
                    <div className="flex items-center gap-2">
                      {/* <button 
                        onClick={handleSeedLogs}
                        disabled={isSeeding}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition flex items-center gap-1 border border-indigo-500/20 px-2.5 py-1 bg-indigo-950/20 rounded cursor-pointer font-bold"
                      >
                        <Database className="w-3.5 h-3.5 animate-pulse" />
                        {isSeeding ? "Seeding..." : "Seed Demo"}
                      </button> */}

                      {telemetry.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          {showClearConfirm ? (
                            <>
                              <button 
                                onClick={() => setShowClearConfirm(false)}
                                className="text-[10px] text-slate-400 hover:text-slate-300 font-bold transition px-2 py-1 border border-slate-700 bg-slate-900 rounded cursor-pointer"
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
                        onChange={(e) => {
  userSelectedDateRef.current = true;
  setSelectedDate(e.target.value);
}}
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

                  {/* Reset Filters / Record Count */}
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-[10px] text-slate-500 font-bold">
                      Showing {filteredTelemetry.length} of {telemetry.length} packets
                    </span>
                    {(startTimeFilter !== "00:00" || endTimeFilter !== "23:59") && (
                      <button 
                        onClick={() => {
                          setStartTimeFilter("00:00");
                          setEndTimeFilter("23:59");
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
    <td colSpan={9} className="p-12 text-center text-slate-500 bg-slate-900/10">
      <div className="flex flex-col items-center gap-3 py-6">
        <RefreshCw className="w-5 h-5 text-slate-600" />
        <span className="text-xs text-slate-500 font-mono">No packets found for the selected date / time range.</span>
      </div>
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

                          const uniqueId = `${item.craneId}-${item.timestamp}`;
                          const isHighlighted = highlightedRowId === uniqueId;

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
                              <td className={`p-3 pl-4 text-slate-400 font-medium whitespace-nowrap transition-all duration-700 ${
                                isHighlighted ? "bg-emerald-950/50 border-y border-emerald-500/30 animate-pulse text-emerald-300" : ""
                              }`}>
                                <span className={`font-bold block ${isHighlighted ? "text-emerald-200" : "text-white"}`}>
                                  {formatISTTime(item.timestamp)} <span className="text-[9px] text-indigo-400 font-normal">IST</span>
                                </span>
                                <span className="text-[10px] text-slate-500 block leading-tight mt-0.5">
                                  UTC: {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' })}
                                </span>
                                <span className="text-[9px] text-slate-600 block mt-0.5 leading-none">
                                  Date: {formatISTDate(item.timestamp)} (IST) | {new Date(item.timestamp).toLocaleDateString([], { month: '2-digit', day: '2-digit', timeZone: 'UTC' })} (UTC)
                                </span>
                              </td>

                              {/* DEVICE ID COLUMN */}
                              <td className={`p-3 font-bold text-white whitespace-nowrap transition-all duration-700 ${
                                isHighlighted ? "bg-emerald-950/50 border-y border-emerald-500/30" : ""
                              }`}>
                                <span className={`px-1.5 py-0.5 rounded border font-bold ${
                                  isHighlighted ? "bg-emerald-900/50 border-emerald-500/50 text-emerald-200" : "bg-slate-900 border-slate-800"
                                }`}>
                                  {item.craneId}
                                </span>
                              </td>

                              {/* STATE COLUMN */}
                              <td className={`p-3 whitespace-nowrap transition-all duration-700 ${
                                isHighlighted ? "bg-emerald-950/50 border-y border-emerald-500/30" : ""
                              }`}>
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
                      onChange={(e) => {
  userSelectedDateRef.current = true;
  setSelectedDate(e.target.value);
}}
                      className="bg-transparent text-[11px] font-bold text-indigo-300 focus:outline-none cursor-pointer [color-scheme:dark]"
                    />
                  </div>
                </div>

                 <div className="h-72 w-full mt-2">
                  {(totalDailyOperatingSec + totalDailyIdleSec) > 0 ? (
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
                          tickFormatter={(value) => `${value}m`}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                          itemStyle={{ color: '#f8fafc' }}
                          labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                          formatter={(value: any, name: any) => {
                            const valNum = Number(value);
                            const durationStr = formatDuration(Math.round(valNum * 60));
                            return [`${valNum} min (${durationStr})`, name === "workingMinutes" ? "Working Time" : "Idle Time"];
                          }}
                        />
                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px', fontFamily: 'monospace' }} />
                        <Bar dataKey="workingMinutes" name="Working Time" fill="#6366f1" stackId="a" />
                        <Bar dataKey="idleMinutes" name="Idle Time" fill="#475569" stackId="a" />
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
                      Rolling real-time plot of hoist weights with safety thresholds (Main: 63,000 kg / Aux: 10,000 kg).
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
                              time: formatISTTime(t.timestamp),
                              utcTime: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' }),
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
                          labelFormatter={(label, items) => {
                            const payload = items?.[0]?.payload;
                            if (payload?.utcTime) {
                              return `${label} (IST) / ${payload.utcTime} (UTC)`;
                            }
                            return `${label} (IST)`;
                          }}
                          formatter={(value: any, name: any) => {
                            let displayName = name;
                            if (name === "Main Hoist Weight") displayName = "MHW";
                            else if (name === "Aux Hoist Weight") displayName = "AHW";
                            else if (name === "Main Hoist Safety Limit") displayName = "MHW Limit";
                            else if (name === "Aux Hoist Safety Limit") displayName = "AHW Limit";
                            return [`${value.toLocaleString()} kg`, displayName];
                          }}
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
                            time: formatISTTime(t.timestamp),
                            utcTime: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' }),
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
                          labelFormatter={(label, items) => {
                            const payload = items?.[0]?.payload;
                            if (payload?.utcTime) {
                              return `${label} (IST) / ${payload.utcTime} (UTC)`;
                            }
                            return `${label} (IST)`;
                          }}
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
