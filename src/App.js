import React, { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Activity, Clock, Zap, Volume2, VolumeX } from 'lucide-react';

const WhaleTrackerMobile = () => {
  const [trades, setTrades] = useState([]);
  const [tradingPair, setTradingPair] = useState('BTCUSDT');
  const [isTracking, setIsTracking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [stats, setStats] = useState({
    binance: { total: 0, buy: 0, sell: 0, count: 0 },
    bybit: { total: 0, buy: 0, sell: 0, count: 0 },
    coinbase: { total: 0, buy: 0, sell: 0, count: 0 }
  });
  const [thresholds, setThresholds] = useState({
    binance: 10000,
    bybit: 10000,
    coinbase: 10000
  });
  const intervalRef = useRef(null);
  const audioRef = useRef(null);
  const lastTradeIds = useRef({ binance: new Set(), bybit: new Set(), coinbase: new Set() });

  // Dinamik eşik hesaplama
  const calculateThresholds = async (symbol) => {
    try {
      const binanceSymbol = symbol.replace('/', '');
      const response = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${binanceSymbol}`);
      const data = await response.json();
      
      const volume = parseFloat(data.quoteVolume);
      const count = parseFloat(data.count);
      const avg = volume / count;
      const threshold = Math.max(2000, Math.min(50000, avg * 8));
      
      setThresholds({
        binance: Math.round(threshold),
        bybit: Math.round(threshold),
        coinbase: Math.round(threshold)
      });
    } catch (error) {
      console.error('Eşik hesaplanamadı:', error);
    }
  };

  // Ses çal
  const playSound = () => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.volume = 0.2;
      audioRef.current.play().catch(() => {});
    }
  };

  // BINANCE
  const fetchBinance = async (symbol) => {
    try {
      const response = await fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol}&limit=100`);
      const data = await response.json();
      const threshold = thresholds.binance;
      const whaleTrades = [];
      
      data.forEach(trade => {
        const value = parseFloat(trade.p) * parseFloat(trade.q);
        const id = `b-${trade.a}`;
        
        if (value >= threshold && !lastTradeIds.current.binance.has(id)) {
          lastTradeIds.current.binance.add(id);
          whaleTrades.push({
            id,
            exchange: 'BIN',
            timestamp: trade.T,
            price: parseFloat(trade.p),
            quantity: parseFloat(trade.q),
            value: value,
            side: trade.m ? 'SELL' : 'BUY',
            level: value >= threshold * 3 ? 'MEGA' : value >= threshold * 1.5 ? 'BIG' : 'MED',
            time: new Date(trade.T).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
          });
        }
      });
      
      return whaleTrades;
    } catch (error) {
      return [];
    }
  };

  // BYBIT
  const fetchBybit = async (symbol) => {
    try {
      const response = await fetch(`https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${symbol}&limit=100`);
      const data = await response.json();
      
      if (!data.result?.list) return [];
      
      const threshold = thresholds.bybit;
      const whaleTrades = [];
      
      data.result.list.forEach(trade => {
        const value = parseFloat(trade.price) * parseFloat(trade.size);
        const id = `y-${trade.execId}`;
        
        if (value >= threshold && !lastTradeIds.current.bybit.has(id)) {
          lastTradeIds.current.bybit.add(id);
          whaleTrades.push({
            id,
            exchange: 'BYB',
            timestamp: parseInt(trade.time),
            price: parseFloat(trade.price),
            quantity: parseFloat(trade.size),
            value: value,
            side: trade.side === 'Buy' ? 'BUY' : 'SELL',
            level: value >= threshold * 3 ? 'MEGA' : value >= threshold * 1.5 ? 'BIG' : 'MED',
            time: new Date(parseInt(trade.time)).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
          });
        }
      });
      
      return whaleTrades;
    } catch (error) {
      return [];
    }
  };

  // COINBASE
  const fetchCoinbase = async (symbol) => {
    try {
      const symbolMap = {
        'BTCUSDT': 'BTC-USD', 'ETHUSDT': 'ETH-USD', 'SOLUSDT': 'SOL-USD',
        'AVAXUSDT': 'AVAX-USD', 'MATICUSDT': 'MATIC-USD', 'LINKUSDT': 'LINK-USD'
      };
      
      const coinbaseSymbol = symbolMap[symbol] || symbol.replace('USDT', '-USD');
      const response = await fetch(`https://api.exchange.coinbase.com/products/${coinbaseSymbol}/trades?limit=100`);
      
      if (response.status === 404) return [];
      
      const data = await response.json();
      if (!Array.isArray(data)) return [];
      
      const threshold = thresholds.coinbase;
      const whaleTrades = [];
      
      data.forEach(trade => {
        const value = parseFloat(trade.price) * parseFloat(trade.size);
        const id = `c-${trade.trade_id}`;
        
        if (value >= threshold && !lastTradeIds.current.coinbase.has(id)) {
          lastTradeIds.current.coinbase.add(id);
          whaleTrades.push({
            id,
            exchange: 'CBP',
            timestamp: new Date(trade.time).getTime(),
            price: parseFloat(trade.price),
            quantity: parseFloat(trade.size),
            value: value,
            side: trade.side === 'buy' ? 'BUY' : 'SELL',
            level: value >= threshold * 3 ? 'MEGA' : value >= threshold * 1.5 ? 'BIG' : 'MED',
            time: new Date(trade.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
          });
        }
      });
      
      return whaleTrades;
    } catch (error) {
      return [];
    }
  };

  // Tüm borsaları çek
  const fetchAll = async () => {
    try {
      const symbol = tradingPair.replace('/', '');
      const [b, y, c] = await Promise.all([
        fetchBinance(symbol),
        fetchBybit(symbol),
        fetchCoinbase(symbol)
      ]);
      
      const allTrades = [...b, ...y, ...c].sort((a, b) => b.timestamp - a.timestamp);
      
      if (allTrades.length > 0) {
        playSound();
        
        setTrades(prev => {
          const combined = [...allTrades, ...prev].slice(0, 50);
          
          const binanceTrades = combined.filter(t => t.exchange === 'BIN');
          const bybitTrades = combined.filter(t => t.exchange === 'BYB');
          const coinbaseTrades = combined.filter(t => t.exchange === 'CBP');
          
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
            },
            coinbase: {
              count: coinbaseTrades.length,
              total: coinbaseTrades.reduce((s, t) => s + t.value, 0),
              buy: coinbaseTrades.filter(t => t.side === 'BUY').reduce((s, t) => s + t.value, 0),
              sell: coinbaseTrades.filter(t => t.side === 'SELL').reduce((s, t) => s + t.value, 0)
            }
          });
          
          return combined;
        });
      }
    } catch (error) {
      console.error('Fetch error:', error);
    }
  };

  // Tracking
  const toggleTracking = async () => {
    if (!isTracking) {
      lastTradeIds.current = { binance: new Set(), bybit: new Set(), coinbase: new Set() };
      await calculateThresholds(tradingPair);
      await fetchAll();
      intervalRef.current = setInterval(fetchAll, 4000);
      setIsTracking(true);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
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
                <h1 className="text-xl font-bold">Whale Tracker</h1>
                <p className="text-xs text-gray-500">iPhone Optimized</p>
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
            <div className="text-xs text-gray-400 mb-2">Whale Eşikleri</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-yellow-400 text-xs mb-1">BIN</div>
                <div className="text-white text-sm font-bold">{fmt(thresholds.binance)}</div>
              </div>
              <div>
                <div className="text-orange-400 text-xs mb-1">BYB</div>
                <div className="text-white text-sm font-bold">{fmt(thresholds.bybit)}</div>
              </div>
              <div>
                <div className="text-blue-400 text-xs mb-1">CBP</div>
                <div className="text-white text-sm font-bold">{fmt(thresholds.coinbase)}</div>
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
        </div>

        {/* Stats */}
        {isTracking && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-gray-900 rounded-xl p-3 border border-yellow-700">
              <div className="text-yellow-400 text-xs mb-1">BIN</div>
              <div className="text-white text-lg font-bold">{stats.binance.count}</div>
              <div className="text-green-400 text-xs mt-1">{fmt(stats.binance.buy)}</div>
              <div className="text-red-400 text-xs">{fmt(stats.binance.sell)}</div>
            </div>
            <div className="bg-gray-900 rounded-xl p-3 border border-orange-700">
              <div className="text-orange-400 text-xs mb-1">BYB</div>
              <div className="text-white text-lg font-bold">{stats.bybit.count}</div>
              <div className="text-green-400 text-xs mt-1">{fmt(stats.bybit.buy)}</div>
              <div className="text-red-400 text-xs">{fmt(stats.bybit.sell)}</div>
            </div>
            <div className="bg-gray-900 rounded-xl p-3 border border-blue-700">
              <div className="text-blue-400 text-xs mb-1">CBP</div>
              <div className="text-white text-lg font-bold">{stats.coinbase.count}</div>
              <div className="text-green-400 text-xs mt-1">{fmt(stats.coinbase.buy)}</div>
              <div className="text-red-400 text-xs">{fmt(stats.coinbase.sell)}</div>
            </div>
          </div>
        )}

        {/* Trades */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
          <div className="p-3 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            <span className="font-bold">Whale İşlemleri</span>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {trades.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Activity className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Henüz sinyal yok</p>
                <p className="text-xs mt-1">3 borsa taranıyor...</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-800">
                {trades.map((trade, i) => (
                  <div
                    key={trade.id}
                    className={`p-3 active:bg-gray-800 ${i === 0 ? 'bg-gray-800 border-l-4 border-blue-500' : ''}`}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
                          trade.exchange === 'BIN' ? 'bg-yellow-900 text-yellow-300' :
                          trade.exchange === 'BYB' ? 'bg-orange-900 text-orange-300' :
                          'bg-blue-900 text-blue-300'
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
          <p>🌐 Binance • Bybit • Coinbase</p>
          <p className="mt-1">📱 iPhone için optimize edildi</p>
        </div>
      </div>
    </div>
  );
};

export default WhaleTrackerMobile;