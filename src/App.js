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

  // Dinamik eşik hesaplama - 24 saatlik hacme göre
  const calculateDynamicThreshold = async (symbol) => {
    try {
      const response = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`);
      const data = await response.json();
      
      const volume24h = parseFloat(data.quoteVolume); // 24 saatlik USD hacmi
      const tradeCount = parseFloat(data.count); // 24 saatteki işlem sayısı
      
      // Ortalama işlem büyüklüğü
      const avgTradeSize = volume24h / tradeCount;
      
      // Whale eşiği: Ortalama işlemin 50 katı (daha gerçekçi)
      // Minimum 10K, maksimum 500K
      let threshold = avgTradeSize * 50;
      threshold = Math.max(10000, Math.min(500000, threshold));
      
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
      return 50000; // Fallback değer
    }
  };

  // Whale kriterlerini kontrol et
  const isWhaleTransaction = (trade, threshold) => {
    const tradeValue = parseFloat(trade.p) * parseFloat(trade.q);
    const isBuyerMaker = trade.m;
    
    // Temel kriter: Dinamik eşiğin üstünde olmalı
    if (tradeValue < threshold) return null;
    
    // Fiyat etkisi hesapla (önceki işleme göre)
    const priceChange = lastPrice > 0 ? Math.abs((parseFloat(trade.p) - lastPrice) / lastPrice * 100) : 0;
    
    // Whale seviyesi belirleme
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
      side: isBuyerMaker ? 'SELL' : 'BUY', // Buyer maker ise satış, değilse alış
      priceChange: priceChange,
      whaleLevel: whaleLevel,
      severity: severity,
      time: new Date(trade.T).toLocaleTimeString('tr-TR')
    };
  };

  // Ses çal
  const playSound = (severity) => {
    if (audioRef.current) {
      audioRef.current.volume = severity === 'error' ? 0.5 : 0.3;
      audioRef.current.play().catch(e => console.log('Ses çalınamadı'));
    }
  };

  // İşlemleri çek ve filtrele
  const fetchTrades = async () => {
    try {
      const response = await fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${tradingPair}&limit=100`);
      const data = await response.json();
      
      const threshold = dynamicThreshold;
      const whaleTrades = [];
      
      data.forEach(trade => {
        const whaleData = isWhaleTransaction(trade, threshold);
        if (whaleData) {
          whaleTrades.push(whaleData);
        }
      });
      
      if (whaleTrades.length > 0) {
        setTrades(prev => {
          const newTrades = [...whaleTrades, ...prev].slice(0, 50);
          
          // İstatistikleri güncelle
          const buyVol = newTrades.filter(t => t.side === 'BUY').reduce((sum, t) => sum + t.value, 0);
          const sellVol = newTrades.filter(t => t.side === 'SELL').reduce((sum, t) => sum + t.value, 0);
          const totalVol = buyVol + sellVol;
          
          setStats({
            totalWhaleVolume: totalVol,
            buyVolume: buyVol,
            sellVolume: sellVol,
            whaleCount: newTrades.length,
            avgWhaleSize: totalVol / newTrades.length
          });
          
          // Yeni whale için ses çal
          if (whaleTrades[0] && prev.length > 0 && whaleTrades[0].id !== prev[0]?.id) {
            playSound(whaleTrades[0].severity);
          }
          
          return newTrades;
        });
        
        // Son fiyatı güncelle
        setLastPrice(whaleTrades[0].price);
      }
    } catch (error) {
      console.error('İşlemler alınamadı:', error);
    }
  };

  // Tracking başlat/durdur
  const toggleTracking = async () => {
    if (!isTracking) {
      await calculateDynamicThreshold(tradingPair);
      await fetchTrades();
      intervalRef.current = setInterval(fetchTrades, 2000); // 2 saniyede bir güncelle
      setIsTracking(true);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      setIsTracking(false);
    }
  };

  // Temizlik
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Trading pair değiştiğinde yeniden hesapla
  useEffect(() => {
    if (isTracking) {
      calculateDynamicThreshold(tradingPair);
    }
  }, [tradingPair]);

  const formatNumber = (num) => {
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(0)}K`;
    return `$${num.toFixed(0)}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiDcIGWi77eeeTRALUKfj8LZjHAY4ktfyy3ksBSR3x/DdkUAKFF60" />
      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 mb-6 border border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Activity className="w-8 h-8 text-cyan-400" />
              <h1 className="text-3xl font-bold text-white">Whale Tracker Pro</h1>
            </div>
            <div className="flex items-center gap-2">
              {isTracking && (
                <div className="flex items-center gap-2 text-green-400">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-sm font-medium">CANLI</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Trading Pair</label>
              <select
                value={tradingPair}
                onChange={(e) => setTradingPair(e.target.value)}
                disabled={isTracking}
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="BTCUSDT">BTC/USDT</option>
                <option value="ETHUSDT">ETH/USDT</option>
                <option value="BNBUSDT">BNB/USDT</option>
                <option value="SOLUSDT">SOL/USDT</option>
                <option value="XRPUSDT">XRP/USDT</option>
                <option value="ADAUSDT">ADA/USDT</option>
                <option value="DOGEUSDT">DOGE/USDT</option>
                <option value="TRXUSDT">TRX/USDT</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Dinamik Whale Eşiği (Otomatik)
              </label>
              <div className="bg-slate-700 rounded-lg px-4 py-2 border border-slate-600">
                <div className="text-2xl font-bold text-cyan-400">{formatNumber(dynamicThreshold)}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {marketInfo ? `Ort. işlem: ${formatNumber(marketInfo.avgTradeSize)} × 50` : 'Hesaplanıyor...'}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={toggleTracking}
            className={`w-full mt-4 py-3 rounded-lg font-semibold text-white transition-all ${
              isTracking 
                ? 'bg-red-600 hover:bg-red-700' 
                : 'bg-cyan-600 hover:bg-cyan-700'
            }`}
          >
            {isTracking ? 'Tracking Durdur' : 'Tracking Başlat'}
          </button>
        </div>

        {/* İstatistikler */}
        {isTracking && marketInfo && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700">
              <div className="text-slate-400 text-sm mb-1">24s Hacim</div>
              <div className="text-white text-xl font-bold">{formatNumber(marketInfo.volume24h)}</div>
            </div>
            <div className="bg-green-900/20 backdrop-blur-sm rounded-xl p-4 border border-green-700">
              <div className="flex items-center gap-2 text-green-400 text-sm mb-1">
                <TrendingUp className="w-4 h-4" />
                Alış Hacmi
              </div>
              <div className="text-white text-xl font-bold">{formatNumber(stats.buyVolume)}</div>
            </div>
            <div className="bg-red-900/20 backdrop-blur-sm rounded-xl p-4 border border-red-700">
              <div className="flex items-center gap-2 text-red-400 text-sm mb-1">
                <TrendingDown className="w-4 h-4" />
                Satış Hacmi
              </div>
              <div className="text-white text-xl font-bold">{formatNumber(stats.sellVolume)}</div>
            </div>
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700">
              <div className="text-slate-400 text-sm mb-1">Whale Sayısı</div>
              <div className="text-white text-xl font-bold">{stats.whaleCount}</div>
            </div>
          </div>
        )}

        {/* Whale İşlemleri */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700 overflow-hidden">
          <div className="p-4 bg-slate-900/50 border-b border-slate-700">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              Whale İşlemleri
            </h2>
          </div>

          <div className="overflow-x-auto">
            {trades.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Henüz whale işlemi tespit edilmedi</p>
                <p className="text-sm mt-2">Tracking başlatın ve bekleyin...</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {trades.map((trade, index) => (
                  <div
                    key={trade.id}
                    className={`p-4 hover:bg-slate-700/30 transition-colors ${
                      index === 0 ? 'bg-slate-700/50 animate-pulse' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 flex-1">
                        <div className={`px-3 py-1 rounded-full text-xs font-bold ${
                          trade.whaleLevel === 'MEGA' 
                            ? 'bg-purple-900/30 text-purple-300 border border-purple-700'
                            : trade.whaleLevel === 'LARGE'
                            ? 'bg-red-900/30 text-red-300 border border-red-700'
                            : 'bg-yellow-900/30 text-yellow-300 border border-yellow-700'
                        }`}>
                          {trade.whaleLevel} 🐋
                        </div>
                        
                        <div className={`px-3 py-1 rounded-lg text-sm font-bold ${
                          trade.side === 'BUY'
                            ? 'bg-green-900/30 text-green-300'
                            : 'bg-red-900/30 text-red-300'
                        }`}>
                          {trade.side}
                        </div>
                      </div>

                      <div className="flex items-center gap-6 flex-1 justify-end">
                        <div className="text-right">
                          <div className="text-slate-400 text-xs">Değer</div>
                          <div className="text-white text-lg font-bold">{formatNumber(trade.value)}</div>
                        </div>
                        
                        <div className="text-right">
                          <div className="text-slate-400 text-xs">Fiyat</div>
                          <div className="text-slate-300 text-sm font-mono">${trade.price.toLocaleString()}</div>
                        </div>
                        
                        <div className="text-right">
                          <div className="text-slate-400 text-xs">Miktar</div>
                          <div className="text-slate-300 text-sm">{trade.quantity.toFixed(4)}</div>
                        </div>

                        <div className="text-right">
                          <div className="flex items-center gap-1 text-slate-400 text-xs">
                            <Clock className="w-3 h-3" />
                            Saat
                          </div>
                          <div className="text-slate-300 text-sm font-mono">{trade.time}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-6 text-center text-slate-500 text-sm">
          <p>💡 Whale eşiği 24 saatlik ortalama işlem büyüklüğüne göre otomatik hesaplanır</p>
          <p className="mt-1">🔊 Büyük whale işlemleri için sesli uyarı aktif</p>
        </div>
      </div>
    </div>
  );
};

export default WhaleTrackerPro;