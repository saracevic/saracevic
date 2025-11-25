import React, { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Activity, Clock, Zap, Volume2, VolumeX } from 'lucide-react';

const WhaleTrackerMobile = () => {
  const [trades, setTrades] = useState([]);
  const [tradingPair, setTradingPair] = useState('BTCUSDT');
  const [isTracking, setIsTracking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    binance: { total: 0, buy: 0, sell: 0, count: 0 },
    bybit: { total: 0, buy: 0, sell: 0, count: 0 }
  });
  const [thresholds, setThresholds] = useState({
    binance: 20000,
    bybit: 20000
  });
  const MIN_HARD_FILTER = 20000;
  const intervalRef = useRef(null);
  const audioRef = useRef(null);
  const lastTradeIds = useRef({ binance: new Set(), bybit: new Set() });
  const recentTradesWindow = useRef([]);

  // Ses çal
  const playSound = () => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.volume = 0.2;
      audioRef.current.play().catch(() => {});
    }
  };

  // PRO: Cross-exchange korelasyon kontrolü
  const checkCorrelation = (newTrade) => {
    const now = Date.now();
    
    recentTradesWindow.current = recentTradesWindow.current.filter(
      t => now - t.timestamp <= 3000
    );
    
    const correlated = recentTradesWindow.current.find(t => {
      if (t.exchange === newTrade.exchange) return false;
      if (t.side !== newTrade.side) return false;
      
      const timeDiff = Math.abs(newTrade.timestamp - t.timestamp);
      const priceDiff = Math.abs((newTrade.price - t.price) / t.price);
      
      return timeDiff <= 3000 && priceDiff <= 0.0015;
    });
    
    recentTradesWindow.current.push(newTrade);
    return correlated;
  };

  // PRO: Gelişmiş dinamik eşik hesaplama
  const calculateThresholds = async (symbol) => {
    try {
      const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      const data = await response.json();
      
      if (data.code) {
        throw new Error('Binance API Error');
      }
      
      const volume = parseFloat(data.quoteVolume);
      const count = parseFloat(data.count);
      const avg = volume / count;
      
      const threshold = Math.max(5000, Math.min(150000, avg * 15));
      
      setThresholds({
        binance: Math.round(threshold),
        bybit: Math.round(threshold)
      });
      
      setError(null);
    } catch (error) {
      console.error('Eşik hesaplanamadı:', error);
      setThresholds({ binance: 20000, bybit: 20000 });
    }
  };

  // BINANCE - Basit ve çalışan versiyon
  const fetchBinance = async (symbol) => {
    try {
      const response = await fetch(`https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=100`);
      const data = await response.json();
      
      if (!Array.isArray(data)) return [];
      
      const threshold = thresholds.binance;
      const whaleTrades = [];
      
      data.forEach(trade => {
        const value = parseFloat(trade.p) * parseFloat(trade.q);
        const id = `b-${trade.a}`;
        
        if (value < MIN_HARD_FILTER) return;
        if (value >= threshold && !lastTradeIds.current.binance.has(id)) {
          lastTradeIds.current.binance.add(id);
          
          const newTrade = {
            id,
            exchange: 'BIN',
            timestamp: trade.T,
            price: parseFloat(trade.p),
            quantity: parseFloat(trade.q),
            value: value,
            side: trade.m ? 'SELL' : 'BUY',
            level: value >= threshold * 5 ? 'MEGA' : value >= threshold * 2.5 ? 'BIG' : 'MED',
            time: new Date(trade.T).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            correlated: false
          };
          
          const correlatedTrade = checkCorrelation(newTrade);
          if (correlatedTrade) {
            newTrade.correlated = true;
            newTrade.correlatedWith = correlatedTrade.exchange;
          }
          
          whaleTrades.push(newTrade);
        }
      });
      
      return whaleTrades;
    } catch (error) {
      console.error('Binance error:', error);
      return [];
    }
  };

  // BYBIT
  const fetchBybit = async (symbol) => {
    try {
      const response = await fetch(`https://api.bybit.com/v5/market/recent-trade?category=spot&symbol=${symbol}&limit=100`);
      const data = await response.json();
      
      if (!data.result?.list) return [];
      
      const threshold = thresholds.bybit;
      const whaleTrades = [];
      
      data.result.list.forEach(trade => {
        const value = parseFloat(trade.price) * parseFloat(trade.size);
        const id = `y-${trade.execId}`;
        
        if (value < MIN_HARD_FILTER) return;
        if (value >= threshold && !lastTradeIds.current.bybit.has(id)) {
          lastTradeIds.current.bybit.add(id);
          
          const newTrade = {
            id,
            exchange: 'BYB',
            timestamp: parseInt(trade.time),
            price: parseFloat(trade.price),
            quantity: parseFloat(trade.size),
            value: value,
            side: trade.side === 'Buy' ? 'BUY' : 'SELL',
            level: value >= threshold * 5 ? 'MEGA' : value >= threshold * 2.5 ? 'BIG' : 'MED',
            time: new Date(parseInt(trade.time)).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            correlated: false
          };
          
          const correlatedTrade = checkCorrelation(newTrade);
          if (correlatedTrade) {
            newTrade.correlated = true;
            newTrade.correlatedWith = correlatedTrade.exchange;
          }
          
          whaleTrades.push(newTrade);
        }
      });
      
      return whaleTrades;
    } catch (error) {
      console.error('Bybit error:', error);
      return [];
    }
  };

  // Tüm borsaları çek
  const fetchAll = async () => {
    try {
      setError(null);
      const symbol = tradingPair.replace('/', '');
      
      const [b, y] = await Promise.all([
        fetchBinance(symbol),
        fetchBybit(symbol)
      ]);
      
      const allTrades = [...b, ...y].sort((a, b) => b.timestamp - a.timestamp);
      
      if (allTrades.length > 0) {
        playSound();
        
        setTrades(prev => {
          const combined = [...allTrades, ...prev].slice(0, 50);
          
          const binanceTrades = combined.filter(t => t.exchange === 'BIN');
          const bybitTrades = combined.filter(t => t.exchange === 'BYB');
          
          setStats({
            binance: {
              count: binanceTrades.length,
              total: binanceTrades.reduce((s, t) => s + t.value, 0),
              buy: binanceTrades.filter(t => t.side === 'BUY').reduce((s, t) => s + t.value, 0),
              sell: binanceTrades.filter(t => t.side === 'SELL').reduce((s, t) => s + t.value, 0)
            },
            bybit: {
              count: bybitTrades.length,
              total: bybitTrades.reduce((s, t) => s + t.value, 0),
              buy: bybitTrades.filter(t => t.side === 'BUY').reduce((s, t) => s + t.value, 0),
              sell: bybitTrades.filter(t => t.side === 'SELL').reduce((s, t) => s + t.value, 0)
            }
          });
          
          return combined;
        });
      }
    } catch (error) {
      console.error('Fetch error:', error);
      setError('Bağlantı hatası - Lütfen internet bağlantınızı kontrol edin');
    }
  };

  // Tracking
  const toggleTracking = async () => {
    if (!isTracking) {
      lastTradeIds.current = { binance: new Set(), bybit: new Set() };
      recentTradesWindow.current = [];
      await calculateThresholds(tradingPair);
      await fetchAll();
      intervalRef.current = setInterval(fetchAll, 4000);
      setIsTracking(true);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      recentTradesWindow.current = [];
      setIsTracking(false);
    }
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const fmt = (n) => {
    if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };

  return (
    <div className="min-h-screen bg-black text-white p-3">
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiDcIGWi77eeeTRALUKfj8LZjHAY4ktfyy3ksBSR3x/DdkUAKFF60" />
      
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-gray-900 rounded-2xl p-4 mb-3 border border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-7 h-7 text-blue-400" />
              <div>
                <h1 className="text-xl font-bold">Whale Tracker PRO</h1>
                <p className="text-xs text-gray-500">Min $20K • Correlation</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="p-2 bg-gray-800 rounded-lg active:bg-gray-700"
              >
                {soundEnabled ? 
                  <Volume2 className="w-5 h-5 text-green-400" /> : 
                  <VolumeX className="w-5 h-5 text-gray-500" />
                }
              </button>
              {isTracking && (
                <div className="flex items-center gap-2 px-3 py-1 bg-green-900 rounded-full">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-green-400">LIVE</span>
                </div>
              )}
            </div>
          </div>

          <select
            value={tradingPair}
            onChange={(e) => setTradingPair(e.target.value)}
            disabled={isTracking}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 mb-3 border border-gray-700 text-base"
            style={{ fontSize: '16px' }}
          >
            <option value="BTCUSDT">BTC/USDT</option>
            <option value="ETHUSDT">ETH/USDT</option>
            <option value="SOLUSDT">SOL/USDT</option>
            <option value="BNBUSDT">BNB/USDT</option>
            <option value="XRPUSDT">XRP/USDT</option>
            <option value="AVAXUSDT">AVAX/USDT</option>
            <option value="ADAUSDT">ADA/USDT</option>
            <option value="DOGEUSDT">DOGE/USDT</option>
            <option value="MATICUSDT">MATIC/USDT</option>
            <option value="LINKUSDT">LINK/USDT</option>
          </select>

          <div className="bg-gray-800 rounded-xl px-4 py-3 mb-3">
            <div className="text-xs text-gray-400 mb-2">Whale Eşikleri (Auto x15)</div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <div className="text-yellow-400 text-xs mb-1">BINANCE</div>
                <div className="text-white text-sm font-bold">{fmt(thresholds.binance)}</div>
              </div>
              <div>
                <div className="text-orange-400 text-xs mb-1">BYBIT</div>
                <div className="text-white text-sm font-bold">{fmt(thresholds.bybit)}</div>
              </div>
            </div>
          </div>

          <button
            onClick={toggleTracking}
            className={`w-full py-4 rounded-xl font-bold text-lg active:scale-95 transition-transform ${
              isTracking ? 'bg-red-600' : 'bg-blue-600'
            }`}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            {isTracking ? '⏸ Durdur' : '▶ Başlat'}
          </button>
          
          {error && (
            <div className="mt-3 p-3 bg-red-900/50 border border-red-700 rounded-xl text-xs text-red-300">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Stats */}
        {isTracking && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-gray-900 rounded-xl p-3 border border-yellow-700">
              <div className="text-yellow-400 text-xs mb-1">BINANCE</div>
              <div className="text-white text-lg font-bold">{stats.binance.count}</div>
              <div className="text-green-400 text-xs mt-1">↑ {fmt(stats.binance.buy)}</div>
              <div className="text-red-400 text-xs">↓ {fmt(stats.binance.sell)}</div>
            </div>
            <div className="bg-gray-900 rounded-xl p-3 border border-orange-700">
              <div className="text-orange-400 text-xs mb-1">BYBIT</div>
              <div className="text-white text-lg font-bold">{stats.bybit.count}</div>
              <div className="text-green-400 text-xs mt-1">↑ {fmt(stats.bybit.buy)}</div>
              <div className="text-red-400 text-xs">↓ {fmt(stats.bybit.sell)}</div>
            </div>
          </div>
        )}

        {/* Trades */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          <div className="p-3 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            <span className="font-bold">Whale İşlemleri</span>
            <span className="text-xs text-gray-500 ml-auto">Min $20K</span>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {trades.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Activity className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Henüz sinyal yok</p>
                <p className="text-xs mt-1">Binance + Bybit taranıyor...</p>
                <p className="text-xs mt-2 text-gray-600">Minimum: $20,000 USD</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-800">
                {trades.map((trade, i) => (
                  <div
                    key={trade.id}
                    className={`p-3 active:bg-gray-800 ${
                      i === 0 ? 'bg-gray-800 border-l-4 border-blue-500' : ''
                    } ${
                      trade.correlated ? 'border-r-4 border-yellow-500' : ''
                    }`}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
                          trade.exchange === 'BIN' ? 'bg-yellow-900 text-yellow-300' :
                          'bg-orange-900 text-orange-300'
                        }`}>
                          {trade.exchange}
                        </span>
                        
                        <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
                          trade.level === 'MEGA' ? 'bg-purple-900 text-purple-300' :
                          trade.level === 'BIG' ? 'bg-red-900 text-red-300' :
                          'bg-gray-800 text-gray-300'
                        }`}>
                          {trade.level === 'MEGA' ? '🐋 MEGA' : trade.level === 'BIG' ? '🐳 BIG' : '🐟 MED'}
                        </span>
                        
                        <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
                          trade.side === 'BUY' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                        }`}>
                          {trade.side}
                        </span>
                        
                        {trade.correlated && (
                          <span className="px-2 py-1 rounded-lg text-xs font-bold bg-yellow-900 text-yellow-300">
                            ⚡ {trade.correlatedWith}
                          </span>
                        )}
                      </div>
                      
                      <div className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {trade.time}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-gray-500">Değer</div>
                        <div className="text-white font-bold">{fmt(trade.value)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Fiyat</div>
                        <div className="text-white">${trade.price.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Miktar</div>
                        <div className="text-white">{trade.quantity.toFixed(3)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-gray-600 text-xs mt-3 pb-6">
          <p>🌐 Binance • Bybit</p>
          <p className="mt-1">📱 PRO: Min $20K • Threshold x15 • Correlation 3s</p>
          <p className="mt-1 text-gray-700">MEGA: 5x • BIG: 2.5x • Cross-exchange ⚡</p>
        </div>
      </div>
    </div>
  );
};

export default WhaleTrackerMobile;
