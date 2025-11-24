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
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgoedb..." />