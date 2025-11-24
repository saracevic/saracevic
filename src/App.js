import React, { useState, useEffect, useRef } from 'react';

const RECONNECT_DELAY = 5000;
const PAIRS_LIMIT = 100;

export default function App() {
  const EXCHANGES = {
    Binance: {
      pairs: ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT', 'ADAUSDT', 'DOGEUSDT', 'TRXUSDT', 'LINKUSDT', 'AVAXUSDT', 'MATICUSDT'],
      wsUrl: (symbol) => `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@aggTrade`,
      parseMessage: (data) => ({
        symbol: data.s,
        coin: data.s.replace('USDT', ''),
        quantity: parseFloat(data.q),
        price: parseFloat(data.p),
        total: parseFloat(data.p) * parseFloat(data.q),
        side: data.m ? 'SELL' : 'BUY',
        time: new Date(data.T),
      }),
    },
    Bybit: {
      pairs: ['ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'MATICUSDT', 'LINKUSDT'],
      wsUrl: () => `wss://stream.bybit.com/v5/public/linear`,
      subscribe: (ws, pairs) => {
        pairs.forEach((pair) => {
          ws.send(JSON.stringify({ op: 'subscribe', args: [`publicTrade.${pair}`] }));
        });
      },
      parseMessage: (data) => {
        if (data.topic?.startsWith('publicTrade') && data.data?.[0]) {
          const trade = data.data[0];
          return {
            symbol: trade.s,
            coin: trade.s.replace('USDT', ''),
            quantity: parseFloat(trade.v),
            price: parseFloat(trade.p),
            total: parseFloat(trade.v) * parseFloat(trade.p),
            side: trade.S === 'Sell' ? 'SELL' : 'BUY',
            time: new Date(trade.T),
          };
        }
        return null;
      },
    },
    OKX: {
      pairs: ['ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'XRP-USDT-SWAP', 'DOGE-USDT-SWAP', 'ADA-USDT-SWAP'],
      wsUrl: () => `wss://ws.okx.com:8443/ws/v5/public`,
      subscribe: (ws, pairs) => {
        ws.send(JSON.stringify({
          op: 'subscribe',
          args: pairs.map((pair) => ({ channel: 'trades', instId: pair })),
        }));
      },
      parseMessage: (data) => {
        if (data.arg?.channel === 'trades' && data.data?.[0]) {
          const trade = data.data[0];
          const coin = data.arg.instId.split('-')[0];
          return {
            symbol: data.arg.instId,
            coin: coin,
            quantity: parseFloat(trade.sz),
            price: parseFloat(trade.px),
            total: parseFloat(trade.sz) * parseFloat(trade.px),
            side: trade.side === 'sell' ? 'SELL' : 'BUY',
            time: new Date(parseInt(trade.ts)),
          };
        }
        return null;
      },
    },
  };

  const [coinData, setCoinData] = useState({});
  const [threshold, setThreshold] = useState(50000);
  const [selectedExchanges, setSelectedExchanges] = useState(['Binance']);
  const [connectionStatus, setConnectionStatus] = useState({});
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const wsRefs = useRef({});

  const fetchTopPairs = async (exchangeName) => {
    try {
      let pairs = [];
      switch (exchangeName) {
        case 'Binance':
          const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
          const tickers = await res.json();
          pairs = tickers
            .filter((t) => t.symbol.endsWith('USDT') && !['BTCUSDT', 'USDTUSDT'].includes(t.symbol))
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, PAIRS_LIMIT)
            .map((t) => t.symbol);
          break;
        case 'Bybit':
          const bybitRes = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
          const bybitData = await bybitRes.json();
          if (bybitData.result?.list) {
            pairs = bybitData.result.list
              .filter((t) => t.symbol.endsWith('USDT') && !['BTCUSDT', 'USDTUSDT'].includes(t.symbol))
              .sort((a, b) => parseFloat(b.turnover24h || 0) - parseFloat(a.turnover24h || 0))
              .slice(0, PAIRS_LIMIT)
              .map((t) => t.symbol);
          }
          break;
        case 'OKX':
          const okxRes = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SWAP');
          const okxData = await okxRes.json();
          if (okxData.data) {
            pairs = okxData.data
              .filter((t) => t.instId.endsWith('-USDT-SWAP') && !t.instId.startsWith('BTC-'))
              .sort((a, b) => parseFloat(b.volCcy24h || 0) - parseFloat(a.volCcy24h || 0))
              .slice(0, PAIRS_LIMIT)
              .map((t) => t.instId);
          }
          break;
        default:
          pairs = EXCHANGES[exchangeName].pairs;
      }
      return pairs.length > 0 ? pairs : EXCHANGES[exchangeName].pairs;
    } catch (error) {
      console.error(`Error fetching pairs for ${exchangeName}:`, error);
      return EXCHANGES[exchangeName].pairs;
    }
  };

  const handleTradeUpdate = (trade, exchangeName) => {
    if (!trade || trade.total < threshold) return;
    
    setLastUpdate(new Date());
    setCoinData((prev) => {
      const current = prev[trade.coin] || {
        coin: trade.coin,
        buyVolume: 0,
        sellVolume: 0,
        buyCount: 0,
        sellCount: 0,
        totalVolume: 0,
        lastPrice: 0,
        lastUpdate: new Date(),
      };

      return {
        ...prev,
        [trade.coin]: {
          ...current,
          buyVolume: current.buyVolume + (trade.side === 'BUY' ? trade.total : 0),
          sellVolume: current.sellVolume + (trade.side === 'SELL' ? trade.total : 0),
          buyCount: current.buyCount + (trade.side === 'BUY' ? 1 : 0),
          sellCount: current.sellCount + (trade.side === 'SELL' ? 1 : 0),
          totalVolume: current.totalVolume + trade.total,
          lastPrice: trade.price,
          lastUpdate: new Date(),
        },
      };
    });
  };

  const connectBinanceSymbol = (exchangeName, symbol) => {
    const exchange = EXCHANGES[exchangeName];
    const key = `${exchangeName}-${symbol}`;
    const ws = new WebSocket(exchange.wsUrl(symbol));

    ws.onopen = () => {
      setConnectionStatus((prev) => ({ ...prev, [key]: true }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const trade = exchange.parseMessage(data);
      if (trade) handleTradeUpdate(trade, exchangeName);
    };

    ws.onerror = () => {
      setConnectionStatus((prev) => ({ ...prev, [key]: false }));
    };

    ws.onclose = () => {
      setConnectionStatus((prev) => ({ ...prev, [key]: false }));
      setTimeout(() => connectBinanceSymbol(exchangeName, symbol), RECONNECT_DELAY);
    };

    wsRefs.current[key] = ws;
  };

  const connectOtherExchange = (exchangeName, pairs) => {
    const exchange = EXCHANGES[exchangeName];
    const ws = new WebSocket(exchange.wsUrl());

    ws.onopen = () => {
      setConnectionStatus((prev) => ({ ...prev, [exchangeName]: true }));
      if (exchange.subscribe) exchange.subscribe(ws, pairs);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const trade = exchange.parseMessage(data);
      if (trade) handleTradeUpdate(trade, exchangeName);
    };

    ws.onerror = () => {
      setConnectionStatus((prev) => ({ ...prev, [exchangeName]: false }));
    };

    ws.onclose = () => {
      setConnectionStatus((prev) => ({ ...prev, [exchangeName]: false }));
      setTimeout(() => connectOtherExchange(exchangeName, pairs), RECONNECT_DELAY);
    };

    wsRefs.current[exchangeName] = ws;
  };

  useEffect(() => {
    Object.values(wsRefs.current).forEach((ws) => {
      if (ws?.readyState === WebSocket.OPEN) ws.close();
    });
    wsRefs.current = {};

    const connectAll = async () => {
      for (const exchangeName of selectedExchanges) {
        const pairs = await fetchTopPairs(exchangeName);
        if (exchangeName === 'Binance') {
          pairs.forEach((symbol) => connectBinanceSymbol(exchangeName, symbol));
        } else {
          connectOtherExchange(exchangeName, pairs);
        }
      }
    };

    connectAll();

    return () => {
      Object.values(wsRefs.current).forEach((ws) => {
        if (ws?.readyState === WebSocket.OPEN) ws.close();
      });
    };
  }, [selectedExchanges, threshold]);

  const topBuyers = Object.values(coinData)
    .sort((a, b) => b.buyVolume - a.buyVolume)
    .slice(0, 100);

  const topSellers = Object.values(coinData)
    .sort((a, b) => b.sellVolume - a.sellVolume)
    .slice(0, 100);

  const totalStats = Object.values(coinData).reduce(
    (acc, coin) => ({
      totalBuyVolume: acc.totalBuyVolume + coin.buyVolume,
      totalSellVolume: acc.totalSellVolume + coin.sellVolume,
      totalBuyCount: acc.totalBuyCount + coin.buyCount,
      totalSellCount: acc.totalSellCount + coin.sellCount,
    }),
    { totalBuyVolume: 0, totalSellVolume: 0, totalBuyCount: 0, totalSellCount: 0 }
  );

  const isConnected = Object.values(connectionStatus).some((s) => s);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      {/* Header */}
      <div className="max-w-[1800px] mx-auto mb-6 bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl p-6 border border-slate-700 shadow-2xl">
        <div className="flex justify-between items-start flex-wrap gap-6">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
              <span className="text-5xl">🐋</span>
              Premium Whale Tracker
            </h1>
            <div className="flex items-center gap-4 text-sm">
              <span className={`flex items-center gap-2 ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`}></span>
                {isConnected ? 'LIVE' : 'DISCONNECTED'}
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-400">{selectedExchanges.length} Active Exchanges</span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-400">Top 100 Futures</span>
            </div>
          </div>

          <div className="flex gap-4 items-end flex-wrap">
            <div>
              <label className="text-xs text-slate-400 font-semibold mb-2 block">MIN AMOUNT (USD)</label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-36 px-4 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-semibold focus:ring-2 focus:ring-violet-500 focus:outline-none"
              />
            </div>
            <button
              onClick={() => setCoinData({})}
              className="px-6 py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-red-500/50"
            >
              🔄 RESET
            </button>
          </div>
        </div>

        {/* Exchange Selector */}
        <div className="mt-6 p-4 bg-slate-950 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 font-bold mb-3">SELECT EXCHANGES</div>
          <div className="flex gap-3 flex-wrap">
            {Object.keys(EXCHANGES).map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setSelectedExchanges((prev) =>
                    prev.includes(ex) ? prev.filter((e) => e !== ex) : [...prev, ex]
                  );
                }}
                className={`px-5 py-2 rounded-lg font-semibold transition-all ${
                  selectedExchanges.includes(ex)
                    ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-lg shadow-violet-500/50'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {selectedExchanges.includes(ex) && '✓ '}{ex}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <div className="bg-gradient-to-br from-emerald-950 to-emerald-900 p-4 rounded-xl border border-emerald-800">
            <div className="text-emerald-400 text-xs font-bold mb-1">BUY VOLUME</div>
            <div className="text-2xl font-bold text-white">${(totalStats.totalBuyVolume / 1000000).toFixed(2)}M</div>
            <div className="text-emerald-300 text-sm mt-1">{totalStats.totalBuyCount.toLocaleString()} trades</div>
          </div>
          <div className="bg-gradient-to-br from-red-950 to-red-900 p-4 rounded-xl border border-red-800">
            <div className="text-red-400 text-xs font-bold mb-1">SELL VOLUME</div>
            <div className="text-2xl font-bold text-white">${(totalStats.totalSellVolume / 1000000).toFixed(2)}M</div>
            <div className="text-red-300 text-sm mt-1">{totalStats.totalSellCount.toLocaleString()} trades</div>
          </div>
          <div className="bg-gradient-to-br from-blue-950 to-blue-900 p-4 rounded-xl border border-blue-800">
            <div className="text-blue-400 text-xs font-bold mb-1">NET FLOW</div>
            <div className={`text-2xl font-bold ${totalStats.totalBuyVolume > totalStats.totalSellVolume ? 'text-emerald-400' : 'text-red-400'}`}>
              ${Math.abs((totalStats.totalBuyVolume - totalStats.totalSellVolume) / 1000000).toFixed(2)}M
            </div>
            <div className="text-blue-300 text-sm mt-1">{totalStats.totalBuyVolume > totalStats.totalSellVolume ? 'Buy pressure' : 'Sell pressure'}</div>
          </div>
          <div className="bg-gradient-to-br from-amber-950 to-amber-900 p-4 rounded-xl border border-amber-800">
            <div className="text-amber-400 text-xs font-bold mb-1">ACTIVE COINS</div>
            <div className="text-2xl font-bold text-white">{Object.keys(coinData).length}</div>
            <div className="text-amber-300 text-sm mt-1">Tracked assets</div>
          </div>
        </div>
      </div>

      {/* Dual Pivot Tables */}
      <div className="max-w-[1800px] mx-auto grid lg:grid-cols-2 gap-6">
        {/* Top Buyers */}
        <div className="bg-gradient-to-b from-emerald-900/20 to-slate-900 rounded-2xl border border-emerald-800/50 overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              📈 TOP 100 BUY VOLUME
            </h2>
          </div>
          <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 grid grid-cols-4 gap-2 text-xs font-bold text-slate-400">
            <span>RANK</span>
            <span>COIN</span>
            <span className="text-right">VOLUME</span>
            <span className="text-right">TRADES</span>
          </div>
          <div className="max-h-[600px] overflow-y-auto bg-slate-950">
            {topBuyers.length === 0 ? (
              <div className="text-center py-20 text-slate-500">
                <div className="text-5xl mb-4">⏳</div>
                <div className="font-semibold">Waiting for whale trades...</div>
              </div>
            ) : (
              topBuyers.map((coin, idx) => (
                <div
                  key={coin.coin}
                  className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-slate-900 hover:bg-emerald-950/30 transition-colors"
                >
                  <span className="text-slate-500 font-bold">#{idx + 1}</span>
                  <span className="text-emerald-400 font-bold">{coin.coin}</span>
                  <span className="text-right text-white font-semibold">
                    ${(coin.buyVolume / 1000).toFixed(1)}K
                  </span>
                  <span className="text-right text-emerald-300">{coin.buyCount}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Sellers */}
        <div className="bg-gradient-to-b from-red-900/20 to-slate-900 rounded-2xl border border-red-800/50 overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-r from-red-600 to-red-700 px-6 py-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              📉 TOP 100 SELL VOLUME
            </h2>
          </div>
          <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 grid grid-cols-4 gap-2 text-xs font-bold text-slate-400">
            <span>RANK</span>
            <span>COIN</span>
            <span className="text-right">VOLUME</span>
            <span className="text-right">TRADES</span>
          </div>
          <div className="max-h-[600px] overflow-y-auto bg-slate-950">
            {topSellers.length === 0 ? (
              <div className="text-center py-20 text-slate-500">
                <div className="text-5xl mb-4">⏳</div>
                <div className="font-semibold">Waiting for whale trades...</div>
              </div>
            ) : (
              topSellers.map((coin, idx) => (
                <div
                  key={coin.coin}
                  className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-slate-900 hover:bg-red-950/30 transition-colors"
                >
                  <span className="text-slate-500 font-bold">#{idx + 1}</span>
                  <span className="text-red-400 font-bold">{coin.coin}</span>
                  <span className="text-right text-white font-semibold">
                    ${(coin.sellVolume / 1000).toFixed(1)}K
                  </span>
                  <span className="text-right text-red-300">{coin.sellCount}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-[1800px] mx-auto mt-6 text-center text-slate-500 text-sm py-4">
        Premium Multi-Exchange Whale Tracker • Real-time Futures Monitoring • Last Update: {lastUpdate.toLocaleTimeString()}
      </div>
    </div>
  );
}
