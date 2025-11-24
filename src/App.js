import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, TrendingUp, TrendingDown, Activity, DollarSign, Clock, Zap } from 'lucide-react';

const WhaleTrackerPro = () => {
  const [trades, setTrades] = useState([]);
  const [tradingPair, setTradingPair] = useState('BTCUSDT');
  const [isTracking, setIsTracking] = useState(false);
  const [lastPrice, setLastPrice] = useState(0);
  const [stats, setStats] = useState({
    totalWhaleVolume: 0,
    buyVolume: 0,
    sellVolume: 0,
    whaleCount: 0,
    avgWhaleSize: 0
  });
  const [marketInfo, setMarketInfo] = useState(null);
  const [dynamicThreshold, setDynamicThreshold] = useState(50000);
  const intervalRef = useRef(null);
  const audioRef = useRef(null);

  // --- İlk fiyatı yükle ---
  useEffect(() => {
    const loadInitialPrice = async () => {
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${tradingPair}`);
        const d = await res.json();
        setLastPrice(parseFloat(d.price));
      } catch (err) {
        console.error("Başlangıç fiyatı alınamadı:", err);
      }
    };
    loadInitialPrice();
  }, [tradingPair]);

  // Dinamik eşik hesaplama
  const calculateDynamicThreshold = async (symbol) => {
    try {
      const response = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`);
      const data = await response.json();
      
      const volume24h = parseFloat(data.quoteVolume);
      const tradeCount = parseFloat(data.count);
      
      const avgTradeSize = volume24h / tradeCount;

      // Düzeltildi → daha mantıklı threshold
      let threshold = avgTradeSize * 20;

      threshold = Math.max(2000, Math.min(300000, threshold)); // min 2K max 300K

      setMarketInfo({
        volume24h: volume24h,
        tradeCount: tradeCount,
        avgTradeSize: avgTradeSize,
        lastPrice: parseFloat(data.lastPrice)
      });
      
      setDynamicThreshold(Math.round(threshold));
      setLastPrice(parseFloat(data.lastPrice));
      
      return threshold;
    } catch (error) {
      console.error('Dinamik eşik hesaplanamadı:', error);
      return 5000;
    }
  };

  // Whale kriteri
  const isWhaleTransaction = (trade, threshold) => {
    const tradeValue = parseFloat(trade.p) * parseFloat(trade.q);

    if (tradeValue < threshold) return null;

    const isBuyerMaker = trade.m;

    // Whale seviyesi
    let whaleLevel = 'MEDIUM';
    let severity = 'warning';

    if (tradeValue >= threshold * 5) {
      whaleLevel = 'MEGA';
      severity = 'error';
    } else if (tradeValue >= threshold * 2) {
      whaleLevel = 'LARGE';
      severity = 'error';
    }

    return {
      id: trade.a,
      timestamp: trade.T,
      price: parseFloat(trade.p),
      quantity: parseFloat(trade.q),
      value: tradeValue,
      side: isBuyerMaker ? 'SELL' : 'BUY',
      whaleLevel,
      severity,
      time: new Date(trade.T).toLocaleTimeString('tr-TR')
    };
  };

  const playSound = (severity) => {
    if (audioRef.current) {
      audioRef.current.volume = severity === 'error' ? 0.5 : 0.3;
      audioRef.current.play().catch(() => {});
    }
  };

  // İşlem çek — limit 1000 !
  const fetchTrades = async () => {
    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${tradingPair}&limit=1000`
      );
      const data = await response.json();

      const threshold = dynamicThreshold;
      const whaleTrades = [];

      data.forEach(trade => {
        const w = isWhaleTransaction(trade, threshold);
        if (w) whaleTrades.push(w);
      });

      if (whaleTrades.length > 0) {
        setTrades(prev => {
          const newTrades = [...whaleTrades, ...prev].slice(0, 50);

          const buyVol = newTrades.filter(t => t.side === 'BUY').reduce((s, t) => s + t.value, 0);
          const sellVol = newTrades.filter(t => t.side === 'SELL').reduce((s, t) => s + t.value, 0);
          const totalVol = buyVol + sellVol;

          setStats({
            totalWhaleVolume: totalVol,
            buyVolume: buyVol,
            sellVolume: sellVol,
            whaleCount: newTrades.length,
            avgWhaleSize: totalVol / newTrades.length
          });

          // Ses
          if (whaleTrades[0] && prev.length > 0 && whaleTrades[0].id !== prev[0]?.id) {
            playSound(whaleTrades[0].severity);
          }

          return newTrades;
        });

        setLastPrice(whaleTrades[0].price);
      }
    } catch (error) {
      console.error("İşlemler alınamadı:", error);
    }
  };

  const toggleTracking = async () => {
    if (!isTracking) {
      await calculateDynamicThreshold(tradingPair);
      await fetchTrades();
      intervalRef.current = setInterval(fetchTrades, 2000);
      setIsTracking(true);
    } else {
      clearInterval(intervalRef.current);
      setIsTracking(false);
    }
  };

  useEffect(() => {
    return () => clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    if (isTracking) calculateDynamicThreshold(tradingPair);
  }, [tradingPair]);

  const formatNumber = (num) => {
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(0)}K`;
    return `$${num.toFixed(0)}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <audio
        ref={audioRef}
        src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiDcIGWi77eeeTRALUKfj8LZjHAY4ktfyy3ksBSR3x/DdkUAKFF60"
      />

      {/* HEADER */}
      <div className="max-w-7xl mx-auto">
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 mb-6 border border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Activity className="w-8 h-8 text-cyan-400" />
              <h1 className="text-3xl font-bold text-white">Whale Tracker Pro</h1>
            </div>

            {isTracking && (
              <div className="flex items-center gap-2 text-green-400">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-sm font-medium">CANLI</span>
              </div>
            )}
          </div>

          {/* Seçim Menüsü */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">Trading Pair</label>
              <select
                value={tradingPair}
                onChange={(e) => setTradingPair(e.target.value)}
                disabled={isTracking}
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600"
              >
                <option value="BTCUSDT">BTC/USDT</option>
                <option value="ETHUSDT">ETH/USDT</option>
                <option value="SOLUSDT">SOL/USDT</option>
                <option value="BNBUSDT">BNB/USDT</option>
                <option value="XRPUSDT">XRP/USDT</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-2">Dinamik Whale Eşiği</label>
              <div className="bg-slate-700 p-3 rounded-lg border border-slate-600">
                <div className="text-2xl font-bold text-cyan-400">{formatNumber(dynamicThreshold)}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {marketInfo ? `Ort. işlem: ${formatNumber(marketInfo.avgTradeSize)} × 20` : "Hesaplanıyor..."}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={toggleTracking}
            className={`w-full mt-4 py-3 rounded-lg text-white font-semibold ${
              isTracking ? "bg-red-600" : "bg-cyan-600"
            }`}
          >
            {isTracking ? "Tracking Durdur" : "Tracking Başlat"}
          </button>
        </div>

        {/* Whale data listesi */}
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="p-4 bg-slate-900 border-b border-slate-700">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              Whale İşlemleri
            </h2>
          </div>

          {trades.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Henüz whale işlemi yok</p>
              <p className="text-sm mt-2">Takip başlatın ve birkaç saniye bekleyin.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700">
              {trades.map((t, i) => (
                <div
                  key={t.id}
                  className={`p-4 transition-colors ${i === 0 ? "bg-slate-700/40 animate-pulse" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          t.whaleLevel === "MEGA"
                            ? "bg-purple-900/30 text-purple-300 border border-purple-700"
                            : t.whaleLevel === "LARGE"
                            ? "bg-red-900/30 text-red-300 border border-red-700"
                            : "bg-yellow-900/30 text-yellow-300 border border-yellow-700"
                        }`}
                      >
                        {t.whaleLevel} 🐋
                      </div>

                      <div
                        className={`px-3 py-1 rounded-lg text-sm font-bold ${
                          t.side === "BUY" ? "bg-green-900/30 text-green-300" : "bg-red-900/30 text-red-300"
                        }`}
                      >
                        {t.side}
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-slate-400 text-xs">Değer</div>
                        <div className="text-white text-lg font-bold">{formatNumber(t.value)}</div>
                      </div>

                      <div className="text-right">
                        <div className="text-slate-400 text-xs">Fiyat</div>
                        <div className="text-slate-300 text-sm font-mono">${t.price.toLocaleString()}</div>
                      </div>

                      <div className="text-right">
                        <div className="text-slate-400 text-xs">Miktar</div>
                        <div className="text-slate-300 text-sm">{t.quantity.toFixed(4)}</div>
                      </div>

                      <div className="text-right">
                        <div className="flex items-center gap-1 text-slate-400 text-xs">
                          <Clock className="w-3 h-3" />
                          Saat
                        </div>
                        <div className="text-slate-300 text-sm font-mono">{t.time}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-slate-500 text-sm">
          <p>💡 Dinamik whale eşiği ortalama işlem büyüklüğüne göre hesaplanır.</p>
          <p>🔊 Büyük whale işlemleri için sesli uyarı aktiftir.</p>
        </div>
      </div>
    </div>
  );
};

export default WhaleTrackerPro;