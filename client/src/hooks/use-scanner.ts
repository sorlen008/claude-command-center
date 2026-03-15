import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface ScanEvent {
  type: "connected" | "scan-start" | "scan-complete";
  version?: number;
  totalEntities?: number;
  duration?: number;
  entityCounts?: Record<string, number>;
}

export function useLiveSync() {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<ScanEvent | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/scanner/events");

      es.addEventListener("connected", (e) => {
        setConnected(true);
        const data = JSON.parse(e.data);
        setLastEvent({ type: "connected", ...data });
      });

      es.addEventListener("scan-start", (e) => {
        const data = JSON.parse(e.data);
        setLastEvent({ type: "scan-start", ...data });
      });

      es.addEventListener("scan-complete", (e) => {
        const data = JSON.parse(e.data);
        setLastEvent({ type: "scan-complete", ...data });
        // Invalidate all queries so UI refreshes with new data
        qc.invalidateQueries();
      });

      es.onerror = () => {
        setConnected(false);
        es?.close();
        // Retry in 5s
        retryTimer = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [qc]);

  return { connected, lastEvent };
}
