import React, { useState, useEffect, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  Clock,
  Zap,
} from "lucide-react";

const WhaleTrackerPro = () => {
  const [trades, setTrades] = useState([]);
  const [tradingPair, setTradingPair] = useState("BTCUSDT");

  const audioBuy = useRef(null);
  const audioSell = useRef(null);

  const wsBinance = useRef(null);
  const wsBybit = useRef(null);
  const wsCoinbase = useRef(null);

  // ======================
  //  COIN BAZLI THRESHOLD
  // ======================
  const thresholdMap = {
    BTCUSDT: 15000,
    ETHUSDT: 7000,
    SOLUSDT: 1500,
    BNBUSDT: 2500,
    XRPUSDT: 800,
    DOGEUSDT: 500,
    AVAXUSDT: 1200,
    ADAUSDT: 600,
    LINKUSDT: 1200,
    TRXUSDT: 500,
  };

  const getThreshold = (pair) => thresholdMap[pair] || 2000;

  // ======================
  //  SES (iPhone için fix)
  // ======================
  useEffect(() => {
    const unlock = () => {
      if (audioBuy.current) audioBuy.current.play().catch(() => {});
      if (audioSell.current) audioSell.current.play().catch(() => {});
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("touchstart", unlock);
    return () => window.removeEventListener("touchstart", unlock);
  }, []);

  // ======================
  //        SOCKETS
  // ======================
  useEffect(() => {
    const pairLower = tradingPair.toLowerCase();

    // BINANCE
    wsBinance.current = new WebSocket(
      `wss://stream.binance.com:9443/ws/${pairLower}@trade`
    );

    wsBinance.current.onmessage = (msg) => {
      const d = JSON.parse(msg.data);
      processTrade({
        exchange: "BINANCE",
        side: d.m ? "SELL" : "BUY",
        price: Number(d.p),
        amount: Number(d.q),
        usd: Number(d.p) * Number(d.q),
        time: d.T,
      });
    };

    // BYBIT
    wsBybit.current = new WebSocket("wss://stream.bybit.com/v5/public/spot");

    wsBybit.current.onopen = () => {
      wsBybit.current.send(
        JSON.stringify({
          op: "subscribe",
          args: [`publicTrade.${tradingPair}`],
        })
      );
    };

    wsBybit.current.onmessage = (msg) => {
      const json = JSON.parse(msg.data);
      if (!json.data) return;
      json.data.forEach((t) =>
        processTrade({
          exchange: "BYBIT",
          side: t.S,
          price: Number(t.p),
          amount: Number(t.v),
          usd: Number(t.p) * Number(t.v),
          time: Number(t.TS),
        })
      );
    };

    // COINBASE
    wsCoinbase.current = new WebSocket("wss://ws-feed.exchange.coinbase.com");

    wsCoinbase.current.onopen = () => {
      wsCoinbase.current.send(
        JSON.stringify({
          type: "subscribe",
          product_ids: [tradingPair.replace("USDT", "-USDT")],
          channels: ["matches"],
        })
      );
    };

    wsCoinbase.current.onmessage = (msg) => {
      const d = JSON.parse(msg.data);
      if (d.type === "match") {
        const usd = Number(d.size) * Number(d.price);
        processTrade({
          exchange: "COINBASE",
          side: d.side === "buy" ? "BUY" : "SELL",
          price: Number(d.price),
          amount: Number(d.size),
          usd,
          time: Date.now(),
        });
      }
    };

    return () => {
      wsBinance.current?.close();
      wsBybit.current?.close();
      wsCoinbase.current?.close();
    };
  }, [tradingPair]);

  // ======================
  //    TRADE PROCESSOR
  // ======================
  const processTrade = (t) => {
    const th = getThreshold(tradingPair);
    if (t.usd < th) return;

    if (t.side === "BUY") audioBuy.current?.play();
    else audioSell.current?.play();

    setTrades((prev) => [
      {
        id: Date.now(),
        ...t,
      },
      ...prev.slice(0, 50),
    ]);
  };

  // ======================
  //        UI
  // ======================
  return (
    <div style={{ background: "#0e0e0e", color: "white", padding: 20 }}>
      <audio ref={audioBuy} src="/trink.mp3" preload="auto" />
      <audio ref={audioSell} src="/dong.mp3" preload="auto" />

      <h2 style={{ marginBottom: 10 }}>WhaleTracker Pro</h2>

      <select
        value={tradingPair}
        onChange={(e) => setTradingPair(e.target.value)}
        style={{
          padding: 10,
          fontSize: 16,
          background: "#1c1c1c",
          color: "white",
          borderRadius: 8,
          marginBottom: 20,
        }}
      >
        {Object.keys(thresholdMap).map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <div>
        {trades.map((t) => (
          <div
            key={t.id}
            style={{
              padding: 12,
              marginBottom: 8,
              borderRadius: 8,
              background: t.side === "BUY" ? "#003f1f" : "#3f0000",
            }}
          >
            <strong>{t.exchange}</strong> — {t.side}
            <br />
            <Activity size={14} /> {t.price.toFixed(4)} —
            <DollarSign size={14} /> {t.usd.toLocaleString()}$
          </div>
        ))}
      </div>
    </div>
  );
};

export default WhaleTrackerPro;