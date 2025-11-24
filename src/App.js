import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, TrendingUp, TrendingDown, Activity, Clock, Zap, Volume2, VolumeX } from 'lucide-react';

const WhaleTrackerPro = () => {
  const [trades, setTrades] = useState([]);
  const [tradingPair, setTradingPair] = useState('BTCUSDT');
  const [isTracking, setIsTracking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [stats, setStats] = useState({
    totalWhaleVolume: 0,
    buyVolume: 0,
    sellVolume: 0,
    whaleCount: 0,
    binance: { total: 0, buy: 0, sell: 0, count: 0 },
    bybit: { total: 0, buy: 0, sell: 0, count: 0 },
    coinbase: { total: 0, buy: 0, sell: 0, count: 0 }
  });
  const [marketInfo, setMarketInfo] = useState(null);
  const [thresholds, setThresholds] = useState({
    binance: 10000,
    bybit: 10000,
    coinbase: 10000
  });
  const [lastUpdate, setLastUpdate] = useState(null);
  const intervalRef = useRef(null);
  const audioRef = useRef(null);
  const lastTradeIds = useRef({ binance: new Set(), bybit: new Set(), coinbase: new Set() });

  // Her borsa için ayrı dinamik eşik hesaplama
  const calculateAllThresholds = async (symbol) => {
    const binanceSymbol = symbol.replace('/', '');
    
    // Coinbase sembol mapping
    const symbolMap = {
      'BTCUSDT': 'BTC-USD', 'ETHUSDT': 'ETH-USD', 'SOLUSDT': 'SOL-USD',
      'AVAXUSDT': 'AVAX-USD', 'MATICUSDT': 'MATIC-USD', 'DOTUSDT': 'DOT-USD',
      'LINKUSDT': 'LINK-USD', 'UNIUSDT': 'UNI-USD', 'LTCUSDT': 'LTC-USD',
      'ADAUSDT': 'ADA-USD', 'ATOMUSDT': 'ATOM-USD', 'XRPUSDT': 'XRP-USD'
    };
    const coinbaseSymbol = symbolMap[symbol] || symbol.replace('USDT', '-USD');

    try {
      // BINANCE threshold
      const binanceData = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${binanceSymbol}`)
        .then(r => r.json())
        .catch(() => null);
      
      let binanceThreshold = 10000;
      if (binanceData) {
        const volume = parseFloat(binanceData.quoteVolume);
        const count = parseFloat(binanceData.count);
        const avg = volume / count;
        binanceThreshold = Math.max(2000, Math.min(80000, avg * 10));
      }

      // BYBIT threshold
      const bybitData = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${binanceSymbol}`)
        .then(r => r.json())
        .catch(() => null);
      
      let bybitThreshold = 10000;
      if (bybitData?.result?.list?.[0]) {
        const item = bybitData.result.list[0];
        const volume = parseFloat(item.turnover24h || 0);
        const avg = volume / 100000; // Bybit işlem sayısı vermiyor, tahmin
        bybitThreshold = Math.max(2000, Math.min(80000, avg * 10));
      }

      // COINBASE threshold
      const coinbaseData = await fetch(`https://api.exchange.coinbase.com/products/${coinbaseSymbol}/stats`)
        .then(r => r.status === 404 ? null : r.json())
        .catch(() => null);
      
      let coinbaseThreshold = 10000;
      if (coinbaseData) {
        const volume = parseFloat(coinbaseData.volume || 0) * parseFloat(coinbaseData.last || 1);
        const avg = volume / 50000; // Coinbase işlem sayısı yok, tahmin
        coinbaseThreshold = Math.max(2000, Math.min(80000, avg * 10));
      }

      setThresholds({
        binance: Math.round(binanceThreshold),
        bybit: Math.round(bybitThreshold),
        coinbase: Math.round(coinbaseThreshold)
      });

      setMarketInfo({
        volume24h: binanceData ? parseFloat(binanceData.quoteVolume) : 0,
        avgTradeSize: binanceData ? parseFloat(binanceData.quoteVolume) / parseFloat(binanceData.count) : 0,
        lastPrice: binanceData ? parseFloat(binanceData.lastPrice) : 0,
        tradeCount: binanceData ? parseFloat(binanceData.count) : 0
      });

    } catch (error) {
      console.error('Eşikler hesaplanamadı:', error);
      setThresholds({ binance: 10000, bybit: 10000, coinbase: 10000 });
    }
  };

  // Ses çal
  const playSound = () => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.volume = 0.3;
      audioRef.current.play().catch(e => console.log('Ses çalınamadı'));
    }
  };

  // BINANCE İşlemleri - kendi eşiği ile
  const fetchBinanceTrades = async (symbol) => {
    try {
      const binanceSymbol = symbol.replace('/', '');
      const response = await fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${binanceSymbol}&limit=200`);
      const data = await response.json();
      
      const threshold = thresholds.binance;
      const whaleTrades = [];
      
      data.forEach(trade => {
        const tradeValue = parseFloat(trade.p) * parseFloat(trade.q);
        const tradeId = `binance-${trade.a}`;
        
        if (tradeValue >= threshold && !lastTradeIds.current.binance.has(tradeId)) {
          lastTradeIds.current.binance.add(tradeId);
          
          let whaleLevel = 'MEDIUM';
          if (tradeValue >= threshold * 5) whaleLevel = 'MEGA';
          else if (tradeValue >= threshold * 2) whaleLevel = 'LARGE';
          
          whaleTrades.push({
            id: tradeId,
            exchange: 'BINANCE',
            timestamp: trade.T,
            price: parseFloat(trade.p),
            quantity: parseFloat(trade.q),
            value: tradeValue,
            side: trade.m ? 'SELL' : 'BUY',
            whaleLevel: whaleLevel,
            time: new Date(trade.T).toLocaleTimeString('tr-TR')
          });
        }
      });
      
      if (lastTradeIds.current.binance.size > 500) {
        const arr = Array.from(lastTradeIds.current.binance);
        lastTradeIds.current.binance = new Set(arr.slice(-500));
      }
      
      return whaleTrades;
    } catch (error) {
      console.error('Binance hatası:', error);
      return [];
    }
  };

  // BYBIT İşlemleri - kendi eşiği ile
  const fetchBybitTrades = async (symbol) => {
    try {
      const bybitSymbol = symbol.replace('/', '');
      const response = await fetch(`https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${bybitSymbol}&limit=200`);
      const data = await response.json();
      
      if (!data.result || !data.result.list) return [];
      
      const threshold = thresholds.bybit;
      const whaleTrades = [];
      
      data.result.list.forEach(trade => {
        const tradeValue = parseFloat(trade.price) * parseFloat(trade.size);
        const tradeId = `bybit-${trade.execId}`;
        
        if (tradeValue >= threshold && !lastTradeIds.current.bybit.has(tradeId)) {
          lastTradeIds.current.bybit.add(tradeId);
          
          let whaleLevel = 'MEDIUM';
          if (tradeValue >= threshold * 5) whaleLevel = 'MEGA';
          else if (tradeValue >= threshold * 2) whaleLevel = 'LARGE';
          
          whaleTrades.push({
            id: tradeId,
            exchange: 'BYBIT',
            timestamp: parseInt(trade.time),
            price: parseFloat(trade.price),
            quantity: parseFloat(trade.size),
            value: tradeValue,
            side: trade.side === 'Buy' ? 'BUY' : 'SELL',
            whaleLevel: whaleLevel,
            time: new Date(parseInt(trade.time)).toLocaleTimeString('tr-TR')
          });
        }
      });
      
      if (lastTradeIds.current.bybit.size > 500) {
        const arr = Array.from(lastTradeIds.current.bybit);
        lastTradeIds.current.bybit = new Set(arr.slice(-500));
      }
      
      return whaleTrades;
    } catch (error) {
      console.error('Bybit hatası:', error);
      return [];
    }
  };

  // COINBASE İşlemleri - kendi eşiği ile
  const fetchCoinbaseTrades = async (symbol) => {
    try {
      const symbolMap = {
        'BTCUSDT': 'BTC-USD', 'ETHUSDT': 'ETH-USD', 'SOLUSDT': 'SOL-USD',
        'AVAXUSDT': 'AVAX-USD', 'MATICUSDT': 'MATIC-USD', 'DOTUSDT': 'DOT-USD',
        'LINKUSDT': 'LINK-USD', 'UNIUSDT': 'UNI-USD', 'LTCUSDT': 'LTC-USD',
        'ADAUSDT': 'ADA-USD', 'ATOMUSDT': 'ATOM-USD', 'XRPUSDT': 'XRP-USD'
      };
      
      const coinbaseSymbol = symbolMap[symbol] || symbol.replace('USDT', '-USD');
      const response = await fetch(`https://api.exchange.coinbase.com/products/${coinbaseSymbol}/trades?limit=200`);
      
      if (response.status === 404) {
        console.log(`${coinbaseSymbol} Coinbase'de mevcut değil`);
        return [];
      }
      
      const data = await response.json();
      if (!Array.isArray(data)) return [];
      
      const threshold = thresholds.coinbase;
      const whaleTrades = [];
      
      data.forEach(trade => {
        const tradeValue = parseFloat(trade.price) * parseFloat(trade.size);
        const tradeId = `coinbase-${trade.trade_id}`;
        
        if (tradeValue >= threshold && !lastTradeIds.current.coinbase.has(tradeId)) {
          lastTradeIds.current.coinbase.add(tradeId);
          
          let whaleLevel = 'MEDIUM';
          if (tradeValue >= threshold * 5) whaleLevel = 'MEGA';
          else if (tradeValue >= threshold * 2) whaleLevel = 'LARGE';
          
          whaleTrades.push({
            id: tradeId,
            exchange: 'COINBASE',
            timestamp: new Date(trade.time).getTime(),
            price: parseFloat(trade.price),
            quantity: parseFloat(trade.size),
            value: tradeValue,
            side: trade.side === 'buy' ? 'BUY' : 'SELL',
            whaleLevel: whaleLevel,
            time: new Date(trade.time).toLocaleTimeString('tr-TR')
          });
        }
      });
      
      if (lastTradeIds.current.coinbase.size > 500) {
        const arr = Array.from(lastTradeIds.current.coinbase);
        lastTradeIds.current.coinbase = new Set(arr.slice(-500));
      }
      
      return whaleTrades;
    } catch (error) {
      console.error('Coinbase hatası:', error);
      return [];
    }
  };

  // Tüm borsaları kontrol et
  const fetchAllTrades = async () => {
    try {
      const [binanceTrades, bybitTrades, coinbaseTrades] = await Promise.all([
        fetchBinanceTrades(tradingPair),
        fetchBybitTrades(tradingPair),
        fetchCoinbaseTrades(tradingPair)
      ]);
      
      const allNewTrades = [...binanceTrades, ...bybitTrades, ...coinbaseTrades]
        .sort((a, b) => b.timestamp - a.timestamp);
      
      if (allNewTrades.length > 0) {
        playSound();
        
        setTrades(prev => {
          const combined = [...allNewTrades, ...prev].slice(0, 100);
          
          // Toplam istatistikler
          const buyVol = combined.filter(t => t.side === 'BUY').reduce((sum, t) => sum + t.value, 0);
          const sellVol = combined.filter(t => t.side === 'SELL').reduce((sum, t) => sum + t.value, 0);
          
          // Borsa bazlı istatistikler
          const binanceTrades = combined.filter(t => t.exchange === 'BINANCE');
          const bybitTrades = combined.filter(t => t.exchange === 'BYBIT');
          const coinbaseTrades = combined.filter(t => t.exchange === 'COINBASE');
          
          setStats({
            totalWhaleVolume: buyVol + sellVol,
            buyVolume: buyVol,
            sellVolume: sellVol,
            whaleCount: combined.length,
            binance: {
              count: binanceTrades.length,
              total: binanceTrades.reduce((sum, t) => sum + t.value, 0),
              buy: binanceTrades.filter(t => t.side === 'BUY').reduce((sum, t) => sum + t.value, 0),
              sell: binanceTrades.filter(t => t.side === 'SELL').reduce((sum, t) => sum + t.value, 0)
            },
            bybit: {
              count: bybitTrades.length,
              total: bybitTrades.reduce((sum, t) => sum + t.value, 0),
              buy: bybitTrades.filter(t => t.side === 'BUY').reduce((sum, t) => sum + t.value, 0),
              sell: bybitTrades.filter(t => t.side === 'SELL').reduce((sum, t) => sum + t.value, 0)
            },
            coinbase: {
              count: coinbaseTrades.length,
              total: coinbaseTrades.reduce((sum, t) => sum + t.value, 0),
              buy: coinbaseTrades.filter(t => t.side === 'BUY').reduce((sum, t) => sum + t.value, 0),
              sell: coinbaseTrades.filter(t => t.side === 'SELL').reduce((sum, t) => sum + t.value, 0)
            }
          });
          
          return combined;
        });
        
        setLastUpdate(new Date().toLocaleTimeString('tr-TR'));
      }
    } catch (error) {
      console.error('İşlemler alınamadı:', error);
    }
  };

  // Tracking başlat/durdur
  const toggleTracking = async () => {
    if (!isTracking) {
      lastTradeIds.current = { binance: new Set(), bybit: new Set(), coinbase: new Set() };
      await calculateAllThresholds(tradingPair);
      await fetchAllTrades();
      intervalRef.current = setInterval(fetchAllTrades, 3000);
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

  const formatNumber = (num) => {
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(0)}K`;
    return `$${num.toFixed(0)}`;
  };

  const getExchangeColor = (exchange) => {
    switch(exchange) {
      case 'BINANCE': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50';
      case 'BYBIT': return 'bg-orange-500/20 text-orange-300 border-orange-500/50';
      case 'COINBASE': return 'bg-blue-500/20 text-blue-300 border-blue-500/50';
      default: return 'bg-gray-500/20 text-gray-300 border-gray-500/50';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-blue-950 to-gray-950 p-2 sm:p-4">
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiDcIGWi77eeeTRALUKfj8LZjHAY4ktfyy3ksBSR3x/DdkUAKFF60" />
      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-xl sm:rounded-2xl p-3 sm:p-6 mb-3 sm:mb-6 border border-gray-800 shadow-2xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-gradient-to-br from-blue-500 to-purple-600 p-2 sm:p-2.5 rounded-xl shadow-lg">
                <Activity className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
              </div>
              <div>
                <h1 className="text-xl sm:text-3xl font-bold text-white">Whale Tracker</h1>
                <p className="text-xs sm:text-sm text-gray-400 mt-0.5">Multi-Exchange Pro</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="p-2 sm:p-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-all"
              >
                {soundEnabled ? 
                  <Volume2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" /> : 
                  <VolumeX className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500" />
                }
              </button>
              {isTracking && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 rounded-lg border border-green-500/50">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-green-400">LIVE</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs sm:text-sm font-medium text-gray-300 mb-2">Trading Pair</label>
              <select
                value={tradingPair}
                onChange={(e) => setTradingPair(e.target.value)}
                disabled={isTracking}
                className="w-full bg-gray-800 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm sm:text-base"
              >
                <optgroup label="🔥 Popüler">
                  <option value="BTCUSDT">BTC/USDT</option>
                  <option value="ETHUSDT">ETH/USDT</option>
                  <option value="SOLUSDT">SOL/USDT</option>
                  <option value="BNBUSDT">BNB/USDT</option>
                </optgroup>
                <optgroup label="💎 Altcoin">
                  <option value="XRPUSDT">XRP/USDT</option>
                  <option value="ADAUSDT">ADA/USDT</option>
                  <option value="DOGEUSDT">DOGE/USDT</option>
                  <option value="AVAXUSDT">AVAX/USDT</option>
                  <option value="DOTUSDT">DOT/USDT</option>
                  <option value="MATICUSDT">MATIC/USDT</option>
                  <option value="LINKUSDT">LINK/USDT</option>
                  <option value="ATOMUSDT">ATOM/USDT</option>
                  <option value="UNIUSDT">UNI/USDT</option>
                  <option value="LTCUSDT">LTC/USDT</option>
                  <option value="ETCUSDT">ETC/USDT</option>
                  <option value="TRXUSDT">TRX/USDT</option>
                </optgroup>
                <optgroup label="🆕 Yeni Coinler">
                  <option value="ARBUSDT">ARB/USDT</option>
                  <option value="OPUSDT">OP/USDT</option>
                  <option value="SUIUSDT">SUI/USDT</option>
                  <option value="APTUSDT">APT/USDT</option>
                  <option value="INJUSDT">INJ/USDT</option>
                  <option value="PEPEUSDT">PEPE/USDT</option>
                  <option value="SHIBUSDT">SHIB/USDT</option>
                  <option value="FLOKIUSDT">FLOKI/USDT</option>
                </optgroup>
                <optgroup label="📊 DeFi">
                  <option value="AAVEUSDT">AAVE/USDT</option>
                  <option value="MKRUSDT">MKR/USDT</option>
                  <option value="COMPUSDT">COMP/USDT</option>
                  <option value="CRVUSDT">CRV/USDT</option>
                  <option value="SUSHIUSDT">SUSHI/USDT</option>
                </optgroup>
                <optgroup label="🎮 Gaming/NFT">
                  <option value="AXSUSDT">AXS/USDT</option>
                  <option value="SANDUSDT">SAND/USDT</option>
                  <option value="MANAUSDT">MANA/USDT</option>
                  <option value="ENJUSDT">ENJ/USDT</option>
                  <option value="GALAUSDT">GALA/USDT</option>
                </optgroup>
              </select>
            </div>

            <div>
              <label className="block text-xs sm:text-sm font-medium text-gray-300 mb-2">
                Whale Eşikleri (Borsa Bazlı)
              </label>
              <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-lg px-3 sm:px-4 py-2 border border-gray-700">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-yellow-400 text-xs font-medium mb-1">Binance</div>
                    <div className="text-white text-sm font-bold">{formatNumber(thresholds.binance)}</div>
                  </div>
                  <div>
                    <div className="text-orange-400 text-xs font-medium mb-1">Bybit</div>
                    <div className="text-white text-sm font-bold">{formatNumber(thresholds.bybit)}</div>
                  </div>
                  <div>
                    <div className="text-blue-400 text-xs font-medium mb-1">Coinbase</div>
                    <div className="text-white text-sm font-bold">{formatNumber(thresholds.coinbase)}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-2 text-center">
                  {marketInfo ? `📊 ${marketInfo.tradeCount?.toLocaleString()} işlem/24s` : 'Hesaplanıyor...'}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={toggleTracking}
            className={`w-full mt-3 sm:mt-4 py-2.5 sm:py-3 rounded-lg font-bold text-white transition-all shadow-lg text-sm sm:text-base ${
              isTracking 
                ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800' 
                : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700'
            }`}
          >
            {isTracking ? '⏸ Tracking Durdur' : '▶ Tracking Başlat'}
          </button>
        </div>

        {/* İstatistikler */}
        {isTracking && (
          <>
            {/* Borsa Kartları */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-3 sm:mb-6">
              {/* BINANCE */}
              <div className="bg-gradient-to-br from-yellow-900/20 to-yellow-950/40 backdrop-blur-xl rounded-xl p-4 border border-yellow-700/50 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse"></div>
                    <h3 className="text-yellow-300 font-bold text-lg">BINANCE</h3>
                  </div>
                  <div className="text-yellow-300 text-xl font-bold">{stats.binance.count}</div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-400 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      Alış
                    </span>
                    <span className="text-white font-bold">{formatNumber(stats.binance.buy)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-red-400 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" />
                      Satış
                    </span>
                    <span className="text-white font-bold">{formatNumber(stats.binance.sell)}</span>
                  </div>
                  <div className="pt-2 border-t border-yellow-700/50">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-yellow-200 font-medium">Toplam</span>
                      <span className="text-yellow-100 font-bold">{formatNumber(stats.binance.total)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span className="text-yellow-300/70">Eşik</span>
                      <span className="text-yellow-200 font-mono text-xs">{formatNumber(thresholds.binance)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* BYBIT */}
              <div className="bg-gradient-to-br from-orange-900/20 to-orange-950/40 backdrop-blur-xl rounded-xl p-4 border border-orange-700/50 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-orange-400 rounded-full animate-pulse"></div>
                    <h3 className="text-orange-300 font-bold text-lg">BYBIT</h3>
                  </div>
                  <div className="text-orange-300 text-xl font-bold">{stats.bybit.count}</div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-400 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      Alış
                    </span>
                    <span className="text-white font-bold">{formatNumber(stats.bybit.buy)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-red-400 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" />
                      Satış
                    </span>
                    <span className="text-white font-bold">{formatNumber(stats.bybit.sell)}</span>
                  </div>
                  <div className="pt-2 border-t border-orange-700/50">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-orange-200 font-medium">Toplam</span>
                      <span className="text-orange-100 font-bold">{formatNumber(stats.bybit.total)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span className="text-orange-300/70">Eşik</span>
                      <span className="text-orange-200 font-mono text-xs">{formatNumber(thresholds.bybit)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* COINBASE */}
              <div className="bg-gradient-to-br from-blue-900/20 to-blue-950/40 backdrop-blur-xl rounded-xl p-4 border border-blue-700/50 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse"></div>
                    <h3 className="text-blue-300 font-bold text-lg">COINBASE</h3>
                  </div>
                  <div className="text-blue-300 text-xl font-bold">{stats.coinbase.count}</div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-400 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      Alış
                    </span>
                    <span className="text-white font-bold">{formatNumber(stats.coinbase.buy)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-red-400 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" />
                      Satış
                    </span>
                    <span className="text-white font-bold">{formatNumber(stats.coinbase.sell)}</span>
                  </div>
                  <div className="pt-2 border-t border-blue-700/50">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-blue-200 font-medium">Toplam</span>
                      <span className="text-blue-100 font-bold">{formatNumber(stats.coinbase.total)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span className="text-blue-300/70">Eşik</span>
                      <span className="text-blue-200 font-mono text-xs">{formatNumber(thresholds.coinbase)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Genel Özet */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 mb-3 sm:mb-6">
              <div className="bg-green-900/30 backdrop-blur-xl rounded-lg sm:rounded-xl p-2.5 sm:p-3 border border-green-800">
                <div className="flex items-center gap-1 text-green-400 text-xs mb-1">
                  <TrendingUp className="w-3 h-3" />
                  <span className="font-medium">TOPLAM ALIŞ</span>
                </div>
                <div className="text-white text-base sm:text-lg font-bold">{formatNumber(stats.buyVolume)}</div>
              </div>
              <div className="bg-red-900/30 backdrop-blur-xl rounded-lg sm:rounded-xl p-2.5 sm:p-3 border border-red-800">
                <div className="flex items-center gap-1 text-red-400 text-xs mb-1">
                  <TrendingDown className="w-3 h-3" />
                  <span className="font-medium">TOPLAM SATIŞ</span>
                </div>
                <div className="text-white text-base sm:text-lg font-bold">{formatNumber(stats.sellVolume)}</div>
              </div>
              <div className="bg-gray-900/80 backdrop-blur-xl rounded-lg sm:rounded-xl p-2.5 sm:p-3 border border-gray-800 col-span-2 sm:col-span-1">
                <div className="text-gray-400 text-xs mb-1 font-medium">TÜM WHALE</div>
                <div className="text-white text-base sm:text-lg font-bold">{stats.whaleCount} İşlem</div>
              </div>
            </div>

            {lastUpdate && (
              <div className="text-center text-xs sm:text-sm text-gray-500 mb-3">
                Son Güncelleme: {lastUpdate}
              </div>
            )}
          </>
        )}

        {/* Whale İşlemleri */}
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-xl sm:rounded-2xl border border-gray-800 overflow-hidden shadow-2xl">
          <div className="p-3 sm:p-4 bg-gradient-to-r from-blue-900/50 to-purple-900/50 border-b border-gray-800">
            <h2 className="text-base sm:text-xl font-bold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400" />
              Whale İşlemleri
            </h2>
          </div>

          <div className="overflow-x-auto">
            {trades.length === 0 ? (
              <div className="p-8 sm:p-12 text-center text-gray-400">
                <AlertCircle className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm sm:text-base">Henüz whale işlemi tespit edilmedi</p>
                <p className="text-xs sm:text-sm mt-2">3 borsa aynı anda taranıyor...</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-800">
                {trades.map((trade, index) => (
                  <div
                    key={trade.id}
                    className={`p-2.5 sm:p-4 hover:bg-gray-800/50 transition-all ${
                      index === 0 ? 'bg-blue-900/20 animate-pulse' : ''
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-xs font-bold border ${getExchangeColor(trade.exchange)}`}>
                          {trade.exchange}
                        </div>
                        
                        <div className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-bold ${
                          trade.whaleLevel === 'MEGA' 
                            ? 'bg-purple-900/40 text-purple-300 border border-purple-600'
                            : trade.whaleLevel === 'LARGE'
                            ? 'bg-red-900/40 text-red-300 border border-red-600'
                            : 'bg-yellow-900/40 text-yellow-300 border border-yellow-600'
                        }`}>
                          {trade.whaleLevel} 🐋
                        </div>
                        
                        <div className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-bold ${
                          trade.side === 'BUY'
                            ? 'bg-green-900/40 text-green-300 border border-green-600'
                            : 'bg-red-900/40 text-red-300 border border-red-600'
                        }`}>
                          {trade.side}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 flex-1 text-xs sm:text-sm">
                        <div>
                          <div className="text-gray-500 text-xs">Değer</div>
                          <div className="text-white font-bold">{formatNumber(trade.value)}</div>
                        </div>
                        
                        <div className="text-right">
                          <div className="text-gray-500 text-xs">Fiyat</div>
                          <div className="text-gray-300 font-mono text-xs sm:text-sm">${trade.price.toLocaleString()}</div>
                        </div>
                        
                        <div className="text-right">
                          <div className="text-gray-500 text-xs">Miktar</div>
                          <div className="text-gray-300 text-xs sm:text-sm">{trade.quantity.toFixed(4)}</div>
                        </div>

                        <div className="text-right">
                          <div className="flex items-center gap-1 text-gray-500 text-xs justify-end">
                            <Clock className="w-3 h-3" />
                          </div>
                          <div className="text-gray-300 font-mono text-xs">{trade.time}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 sm:mt-6 text-center text-gray-500 text-xs sm:text-sm space-y-1">
          <p>🌐 <strong>3 Borsa:</strong> Binance • Bybit • Coinbase</p>
          <p>💡 Her borsa kendi 24s hacmine göre dinamik eşik • Min: $2K, Max: $80K</p>
          <p>🔊 Sesli uyarı • 📱 Mobil uyumlu • ⚡ 3 saniyede bir güncelleme</p>
        </div>
      </div>
    </div>
  );
};

export default WhaleTrackerPro;