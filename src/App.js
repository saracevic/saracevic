import React, { useState, useEffect, useRef } from 'react';

// Yeniden bağlanma gecikme süresi (milisecond)
const RECONNECT_DELAY = 5000;
// Dinamik liste için limit
const PAIRS_LIMIT = 1000;

export default function App() {
  // Trading pairs by exchange - Statik yedek listeler.
  const EXCHANGES = {
    Binance: {
      pairs: [
        'ETHUSDT',
        'BNBUSDT',
        'XRPUSDT',
        'SOLUSDT',
        'ADAUSDT',
        'DOGEUSDT',
        'TRXUSDT',
        'LINKUSDT',
        'AVAXUSDT',
        'MATICUSDT',
      ],
      wsUrl: (symbol) =>
        `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@aggTrade`,
      parseMessage: (data) => ({
        id: data.a,
        symbol: data.s,
        pair: data.s.replace('USDT', '-USDT'),
        quantity: parseFloat(data.q),
        price: parseFloat(data.p),
        total: parseFloat(data.p) * parseFloat(data.q),
        side: data.m ? 'SELL' : 'BUY',
        time: new Date(data.T),
      }),
    },
    Coinbase: {
      pairs: [
        'ETH-USD',
        'SOL-USD',
        'XRP-USD',
        'ADA-USD',
        'DOGE-USD',
        'MATIC-USD',
        'LINK-USD',
      ],
      wsUrl: () => `wss://ws-feed.exchange.coinbase.com`,
      subscribe: (ws, pairs) => {
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            product_ids: pairs,
            channels: ['matches'],
          })
        );
      },
      parseMessage: (data) => {
        if (data.type !== 'match') return null;
        return {
          id: data.trade_id,
          symbol: data.product_id,
          pair: data.product_id,
          quantity: parseFloat(data.size),
          price: parseFloat(data.price),
          total: parseFloat(data.size) * parseFloat(data.price),
          side: data.side === 'sell' ? 'SELL' : 'BUY',
          time: new Date(data.time),
        };
      },
    },
    Bybit: {
      pairs: [
        'ETHUSDT',
        'SOLUSDT',
        'XRPUSDT',
        'DOGEUSDT',
        'ADAUSDT',
        'MATICUSDT',
        'LINKUSDT',
      ],
      wsUrl: () => `wss://stream.bybit.com/v5/public/linear`,
      subscribe: (ws, pairs) => {
        pairs.forEach((pair) => {
          ws.send(
            JSON.stringify({
              op: 'subscribe',
              args: [`publicTrade.${pair}`],
            })
          );
        });
      },
      parseMessage: (data) => {
        if (data.topic && data.topic.startsWith('publicTrade')) {
          const trades = data.data;
          if (trades && trades.length > 0) {
            const trade = trades[0];
            return {
              id: trade.i,
              symbol: trade.s,
              pair: trade.s.replace('USDT', '-USDT'),
              quantity: parseFloat(trade.v),
              price: parseFloat(trade.p),
              total: parseFloat(trade.v) * parseFloat(trade.p),
              side: trade.S === 'Sell' ? 'SELL' : 'BUY',
              time: new Date(trade.T),
            };
          }
        }
        return null;
      },
    },
    OKX: {
      pairs: [
        'ETH-USDT-SWAP',
        'SOL-USDT-SWAP',
        'XRP-USDT-SWAP',
        'DOGE-USDT-SWAP',
        'ADA-USDT-SWAP',
        'MATIC-USDT-SWAP',
        'LINK-USDT-SWAP',
      ],
      wsUrl: () => `wss://ws.okx.com:8443/ws/v5/public`,
      subscribe: (ws, pairs) => {
        ws.send(
          JSON.stringify({
            op: 'subscribe',
            args: pairs.map((pair) => ({
              channel: 'trades',
              instId: pair,
            })),
          })
        );
      },
      parseMessage: (data) => {
        if (data.arg && data.arg.channel === 'trades' && data.data) {
          const trade = data.data[0];
          return {
            id: trade.tradeId,
            symbol: data.arg.instId,
            pair: data.arg.instId,
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
    KuCoin: {
      pairs: [
        'ETHUSDTM',
        'SOLUSDTM',
        'XRPUSDTM',
        'DOGEUSDTM',
        'ADAUSDTM',
        'MATICUSDTM',
        'LINKUSDTM',
      ],
      wsUrl: () => `wss://ws-api-futures.kucoin.com/`,
      subscribe: (ws, pairs) => {
        ws.send(
          JSON.stringify({
            id: Date.now(),
            type: 'subscribe',
            topic: '/contractMarket/execution:' + pairs.join(','),
            response: true,
          })
        );
      },
      parseMessage: (data) => {
        if (data.topic && data.topic.startsWith('/contractMarket/execution')) {
          const trade = data.data;
          return {
            id: trade.tradeId,
            symbol: trade.symbol,
            pair: trade.symbol.replace('USDTM', '-USDT'),
            quantity: parseFloat(trade.size),
            price: parseFloat(trade.price),
            total: parseFloat(trade.size) * parseFloat(trade.price),
            side: trade.side === 'sell' ? 'SELL' : 'BUY',
            time: new Date(parseInt(trade.ts) / 1000000),
          };
        }
        return null;
      },
    },
  };

  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState({ total: 0, buy: 0, sell: 0, volume: 0 });
  const [threshold, setThreshold] = useState(60000);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState({});
  const [filters, setFilters] = useState({
    name: '',
    exchange: '',
    side: '',
  });
  const [selectedExchanges, setSelectedExchanges] = useState(
    Object.keys(EXCHANGES)
  );
  const [dynamicPairs, setDynamicPairs] = useState({});
  const wsRefs = useRef({});
  const audioContextRef = useRef(null);

  // Tüm borsalardan en çok hacme sahip perpetual futures çiftlerini çekme fonksiyonu
  const fetchTopPairs = async (exchangeName, limit = PAIRS_LIMIT) => {
    try {
      let tickers = [];
      let filteredPairs = [];

      switch (exchangeName) {
        case 'Binance':
          const binanceRes = await fetch(
            'https://fapi.binance.com/fapi/v1/ticker/24hr'
          );
          tickers = await binanceRes.json();
          filteredPairs = tickers
            .filter((t) => {
              const symbol = t.symbol;
              if (!symbol.endsWith('USDT')) return false;
              const baseCoin = symbol.replace('USDT', '');
              if (
                baseCoin === 'BTC' ||
                baseCoin === 'USDT' ||
                baseCoin === 'USDC'
              )
                return false;
              return true;
            })
            .sort(
              (a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)
            )
            .slice(0, limit)
            .map((t) => t.symbol);
          break;

        case 'Bybit':
          const bybitRes = await fetch(
            'https://api.bybit.com/v5/market/tickers?category=linear'
          );
          const bybitData = await bybitRes.json();
          if (bybitData.result && bybitData.result.list) {
            filteredPairs = bybitData.result.list
              .filter((t) => {
                const symbol = t.symbol;
                if (!symbol.endsWith('USDT')) return false;
                const baseCoin = symbol.replace('USDT', '');
                if (
                  baseCoin === 'BTC' ||
                  baseCoin === 'USDT' ||
                  baseCoin === 'USDC'
                )
                  return false;
                return true;
              })
              .sort(
                (a, b) =>
                  parseFloat(b.turnover24h || 0) -
                  parseFloat(a.turnover24h || 0)
              )
              .slice(0, limit)
              .map((t) => t.symbol);
          }
          break;

        case 'OKX':
          const okxRes = await fetch(
            'https://www.okx.com/api/v5/public/instruments?instType=SWAP'
          );
          const okxData = await okxRes.json();
          if (okxData.data) {
            const okxTickersRes = await fetch(
              'https://www.okx.com/api/v5/market/tickers?instType=SWAP'
            );
            const okxTickersData = await okxTickersRes.json();

            if (okxTickersData.data) {
              filteredPairs = okxTickersData.data
                .filter((t) => {
                  const symbol = t.instId;
                  if (!symbol.endsWith('-USDT-SWAP')) return false;
                  const baseCoin = symbol.replace('-USDT-SWAP', '');
                  if (
                    baseCoin === 'BTC' ||
                    baseCoin === 'USDT' ||
                    baseCoin === 'USDC'
                  )
                    return false;
                  return true;
                })
                .sort(
                  (a, b) =>
                    parseFloat(b.volCcy24h || 0) - parseFloat(a.volCcy24h || 0)
                )
                .slice(0, limit)
                .map((t) => t.instId);
            }
          }
          break;

        case 'KuCoin':
          const kucoinRes = await fetch(
            'https://api-futures.kucoin.com/api/v1/contracts/active'
          );
          const kucoinData = await kucoinRes.json();
          if (kucoinData.data) {
            filteredPairs = kucoinData.data
              .filter((t) => {
                const symbol = t.symbol;
                if (!symbol.endsWith('USDT')) return false;
                const baseCoin = symbol.replace('USDT', '').replace('M', '');
                if (
                  baseCoin === 'BTC' ||
                  baseCoin === 'USDT' ||
                  baseCoin === 'USDC' ||
                  baseCoin === 'XBT'
                )
                  return false;
                return true;
              })
              .sort(
                (a, b) =>
                  parseFloat(b.turnoverOf24h || 0) -
                  parseFloat(a.turnoverOf24h || 0)
              )
              .slice(0, limit)
              .map((t) => t.symbol);
          }
          break;

        case 'Coinbase':
          return EXCHANGES[exchangeName].pairs;

        default:
          return EXCHANGES[exchangeName].pairs;
      }

      if (filteredPairs.length > 0) {
        setDynamicPairs((prev) => ({
          ...prev,
          [exchangeName]: filteredPairs,
        }));
        console.log(
          `Fetched Top ${filteredPairs.length} Futures pairs for ${exchangeName}`
        );
        return filteredPairs;
      } else {
        console.warn(
          `No futures pairs found for ${exchangeName}, using static list`
        );
        return EXCHANGES[exchangeName].pairs;
      }
    } catch (error) {
      console.error(
        `Error fetching top pairs for ${exchangeName}. Using static list.`,
        error
      );
      return EXCHANGES[exchangeName].pairs;
    }
  };

  const playBuySound = () => {
    if (!soundEnabled) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext ||
          window.webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = 300;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.1);
    } catch (e) {}
  };

  const playSellSound = () => {
    if (!soundEnabled) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext ||
          window.webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = 100;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  };

  const handleTradeUpdate = (trade, exchangeName) => {
    if (trade && trade.total >= threshold) {
      const enrichedTrade = { ...trade, exchange: exchangeName };
      setTrades((prev) => [enrichedTrade, ...prev].slice(0, 200));

      setStats((prev) => ({
        total: prev.total + 1,
        buy: prev.buy + (trade.side === 'BUY' ? 1 : 0),
        sell: prev.sell + (trade.side === 'SELL' ? 1 : 0),
        volume: prev.volume + trade.total,
      }));
      if (trade.side === 'BUY') {
        playBuySound();
      } else {
        playSellSound();
      }
    }
  };

  const reconnect = (exchangeName, symbol = null, pairsToConnect = null) => {
    const key = symbol ? `${exchangeName}-${symbol}` : exchangeName;

    if (
      wsRefs.current[key] &&
      (wsRefs.current[key].readyState === WebSocket.CONNECTING ||
        wsRefs.current[key].reconnectTimeout)
    ) {
      return;
    }

    clearTimeout(wsRefs.current[key]?.reconnectTimeout);

    setConnectionStatus((prev) => ({
      ...prev,
      [key]: false,
    }));

    console.log(
      `Connection for ${key} closed. Attempting reconnect in ${
        RECONNECT_DELAY / 1000
      }s...`
    );

    const timeoutId = setTimeout(() => {
      if (symbol) {
        connectBinanceSymbol(exchangeName, symbol);
      } else {
        connectOtherExchange(exchangeName, pairsToConnect);
      }
      delete wsRefs.current[key].reconnectTimeout;
    }, RECONNECT_DELAY);

    if (wsRefs.current[key]) {
      wsRefs.current[key].reconnectTimeout = timeoutId;
    }
  };

  const connectBinanceSymbol = (exchangeName, symbol) => {
    const exchange = EXCHANGES[exchangeName];
    const key = `${exchangeName}-${symbol}`;

    const ws = new WebSocket(exchange.wsUrl(symbol));

    ws.onopen = () => {
      setConnectionStatus((prev) => ({ ...prev, [key]: true }));
      console.log(`${key} connected`);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const trade = exchange.parseMessage(data);
      handleTradeUpdate(trade, exchangeName);
    };

    ws.onerror = (error) => {
      console.error(`${key} error:`, error);
      reconnect(exchangeName, symbol);
    };

    ws.onclose = () => {
      console.log(`${key} closed.`);
      reconnect(exchangeName, symbol);
    };

    wsRefs.current[key] = ws;
  };

  const connectOtherExchange = (exchangeName, pairsToConnect) => {
    const exchange = EXCHANGES[exchangeName];
    const key = exchangeName + '-MAIN';

    const ws = new WebSocket(exchange.wsUrl());

    ws.onopen = () => {
      setConnectionStatus((prev) => ({ ...prev, [key]: true }));
      console.log(`${key} connected`);
      if (exchange.subscribe) {
        exchange.subscribe(ws, pairsToConnect);
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const trade = exchange.parseMessage(data);
      if (trade) {
        handleTradeUpdate(trade, exchangeName);
      }
    };

    ws.onerror = (error) => {
      console.error(`${key} error:`, error);
      reconnect(exchangeName, null, pairsToConnect);
    };

    ws.onclose = () => {
      console.log(`${key} closed.`);
      reconnect(exchangeName, null, pairsToConnect);
    };

    wsRefs.current[key] = ws;
  };

  useEffect(() => {
    Object.values(wsRefs.current).forEach((ws) => {
      clearTimeout(ws.reconnectTimeout);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    wsRefs.current = {};

    const connectExchanges = async () => {
      const connectionPromises = selectedExchanges.map(async (exchangeName) => {
        const exchange = EXCHANGES[exchangeName];
        if (!exchange) return;

        const pairsToConnect = await fetchTopPairs(exchangeName, PAIRS_LIMIT);

        if (exchangeName === 'Binance') {
          pairsToConnect.forEach((symbol) => {
            connectBinanceSymbol(exchangeName, symbol);
          });
        } else {
          connectOtherExchange(exchangeName, pairsToConnect);
        }
      });

      await Promise.all(connectionPromises);
    };

    connectExchanges();

    return () => {
      Object.values(wsRefs.current).forEach((ws) => {
        clearTimeout(ws.reconnectTimeout);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
    };
  }, [threshold, soundEnabled, selectedExchanges]);

  const handleReset = () => {
    setTrades([]);
    setStats({ total: 0, buy: 0, sell: 0, volume: 0 });
  };

  const handleFilterChange = (filterType, value) => {
    setFilters((prev) => ({
      ...prev,
      [filterType]: value,
    }));
  };

  const toggleExchange = (exchangeName) => {
    setSelectedExchanges((prev) => {
      if (prev.includes(exchangeName)) {
        return prev.filter((e) => e !== exchangeName);
      } else {
        return [...prev, exchangeName];
      }
    });
  };

  const filteredTrades = trades.filter((trade) => {
    if (
      filters.name &&
      !trade.pair.toUpperCase().includes(filters.name.toUpperCase())
    ) {
      return false;
    }
    if (filters.exchange && trade.exchange !== filters.exchange) {
      return false;
    }
    if (filters.side && trade.side !== filters.side) {
      return false;
    }
    return true;
  });

  const uniqueNames = [...new Set(trades.map((t) => t.pair))].sort();
  const uniqueExchanges = [...new Set(trades.map((t) => t.exchange))].sort();
  const isAnyConnected = Object.values(connectionStatus).some(
    (status) => status === true
  );

  const formatTime = (date) => {
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const calculateCoinSummary = () => {
    const summaryData = filteredTrades.reduce((acc, trade) => {
      const pairParts = trade.pair.split('-');
      const coinName = pairParts[0];

      if (!acc[coinName]) {
        acc[coinName] = {
          totalCount: 0,
          totalQuantity: 0,
          totalVolume: 0,
          buyQuantity: 0,
          sellQuantity: 0,
          buyVolume: 0,
          sellVolume: 0,
        };
      }

      acc[coinName].totalCount += 1;
      acc[coinName].totalQuantity += trade.quantity;
      acc[coinName].totalVolume += trade.total;

      if (trade.side === 'BUY') {
        acc[coinName].buyQuantity += trade.quantity;
        acc[coinName].buyVolume += trade.total;
      } else {
        acc[coinName].sellQuantity += trade.quantity;
        acc[coinName].sellVolume += trade.total;
      }

      return acc;
    }, {});

    return Object.entries(summaryData)
      .map(([coin, data]) => ({
        coinName: coin,
        ...data,
      }))
      .sort((a, b) => b.totalVolume - a.totalVolume);
  };

  const coinSummary = calculateCoinSummary();

  const overallTotal = coinSummary.reduce(
    (acc, curr) => {
      acc.totalCount += curr.totalCount;
      acc.totalVolume += curr.totalVolume;
      acc.buyVolume += curr.buyVolume;
      acc.sellVolume += curr.sellVolume;
      return acc;
    },
    { totalCount: 0, totalVolume: 0, buyVolume: 0, sellVolume: 0 }
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'linear-gradient(to bottom right, #0f172a, #1e293b, #0f172a)',
        padding: '16px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: '1800px',
          margin: '0 auto 16px',
          backgroundColor: '#1e293b',
          borderRadius: '16px',
          padding: '20px',
          border: '1px solid #334155',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <h1
              style={{
                color: 'white',
                fontSize: '28px',
                margin: '0 0 8px 0',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              🐋 Multi-Exchange Futures Whale Tracker
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0 }}>
              {isAnyConnected ? (
                <span style={{ color: '#22c55e' }}>● Live</span>
              ) : (
                <span style={{ color: '#ef4444' }}>● Disconnected</span>
              )}{' '}
              • {selectedExchanges.length} Active Exchanges • Top 100 Perpetual
              Contracts
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
            >
              <label
                style={{
                  color: '#94a3b8',
                  fontSize: '11px',
                  fontWeight: '600',
                }}
              >
                Min Amount (USD)
              </label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                style={{
                  width: '120px',
                  padding: '8px 12px',
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                }}
              />
            </div>

            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              style={{
                marginTop: '20px',
                padding: '8px 16px',
                backgroundColor: soundEnabled ? '#10b981' : '#6b7280',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              {soundEnabled ? '🔊 Sound On' : '🔇 Sound Off'}
            </button>

            <button
              onClick={handleReset}
              style={{
                marginTop: '20px',
                padding: '8px 16px',
                backgroundColor: '#dc2626',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              🔄 Reset
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: '20px',
            padding: '16px',
            backgroundColor: '#0f172a',
            borderRadius: '12px',
            border: '1px solid #334155',
          }}
        >
          <div
            style={{
              color: '#94a3b8',
              fontSize: '12px',
              fontWeight: '600',
              marginBottom: '12px',
            }}
          >
            SELECT EXCHANGES:
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {Object.keys(EXCHANGES).map((exchangeName) => (
              <button
                key={exchangeName}
                onClick={() => toggleExchange(exchangeName)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: selectedExchanges.includes(exchangeName)
                    ? '#7c3aed'
                    : '#334155',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {selectedExchanges.includes(exchangeName) && '✓'} {exchangeName}
                {connectionStatus[exchangeName] && (
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: '#22c55e',
                    }}
                  ></span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
            marginTop: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: '#0f172a',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid #1e293b',
            }}
          >
            <div
              style={{
                color: '#94a3b8',
                fontSize: '12px',
                marginBottom: '6px',
                fontWeight: '600',
              }}
            >
              Total Trades
            </div>
            <div
              style={{ color: '#60a5fa', fontSize: '28px', fontWeight: 'bold' }}
            >
              {stats.total.toLocaleString()}
            </div>
          </div>
          <div
            style={{
              backgroundColor: '#0f172a',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid #1e293b',
            }}
          >
            <div
              style={{
                color: '#94a3b8',
                fontSize: '12px',
                marginBottom: '6px',
                fontWeight: '600',
              }}
            >
              Buy Orders
            </div>
            <div
              style={{ color: '#22c55e', fontSize: '28px', fontWeight: 'bold' }}
            >
              {stats.buy.toLocaleString()}
            </div>
          </div>
          <div
            style={{
              backgroundColor: '#0f172a',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid #1e293b',
            }}
          >
            <div
              style={{
                color: '#94a3b8',
                fontSize: '12px',
                marginBottom: '6px',
                fontWeight: '600',
              }}
            >
              Sell Orders
            </div>
            <div
              style={{ color: '#ef4444', fontSize: '28px', fontWeight: 'bold' }}
            >
              {stats.sell.toLocaleString()}
            </div>
          </div>
          <div
            style={{
              backgroundColor: '#0f172a',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid #1e293b',
            }}
          >
            <div
              style={{
                color: '#94a3b8',
                fontSize: '12px',
                marginBottom: '6px',
                fontWeight: '600',
              }}
            >
              Total Volume
            </div>
            <div
              style={{ color: '#fbbf24', fontSize: '28px', fontWeight: 'bold' }}
            >
              ${(stats.volume / 1000000).toFixed(2)}M
            </div>
          </div>
        </div>
      </div>

      {/* Coin Summary Table (New Section) */}
      {coinSummary.length > 0 && (
        <div
          style={{
            maxWidth: '1800px',
            margin: '0 auto 16px',
            backgroundColor: '#1e293b',
            borderRadius: '16px',
            border: '1px solid #334155',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(to right, #60a5fa, #3b82f6)',
              padding: '16px 20px',
              color: 'white',
              fontSize: '16px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '20px' }}>⭐</span>
            Coin Bazında Toplu Özet (≥${threshold.toLocaleString()})
          </div>

          {/* Coin Summary Table Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr repeat(5, minmax(120px, 1fr))',
              gap: '12px',
              padding: '14px 20px',
              fontSize: '11px',
              color: '#94a3b8',
              fontWeight: '700',
              backgroundColor: '#1e293b',
              borderBottom: '2px solid #334155',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              textAlign: 'right',
            }}
          >
            <span style={{ textAlign: 'left' }}>Coin Adı</span>
            <span>İşlem Sayısı</span>
            <span>Toplam Hacim (USD)</span>
            <span>Alış Hacmi (USD)</span>
            <span>Satış Hacmi (USD)</span>
            <span>Net Hacim (USD)</span>
          </div>

          {/* Coin Summary Table Body */}
          <div style={{ backgroundColor: '#0f172a' }}>
            {coinSummary.map((data, idx) => (
              <div
                key={data.coinName}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr repeat(5, minmax(120px, 1fr))',
                  gap: '12px',
                  padding: '14px 20px',
                  fontSize: '13px',
                  borderBottom: '1px solid #1e293b',
                  backgroundColor: idx % 2 === 0 ? '#0f172a' : '#1a1f2e',
                  textAlign: 'right',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    color: '#60a5fa',
                    fontWeight: '700',
                    textAlign: 'left',
                  }}
                >
                  {data.coinName}
                </span>
                <span style={{ color: '#e2e8f0', fontWeight: '600' }}>
                  {data.totalCount.toLocaleString()}
                </span>
                <span style={{ color: '#fbbf24', fontWeight: '700' }}>
                  $
                  {data.totalVolume.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span style={{ color: '#22c55e', fontWeight: '600' }}>
                  $
                  {data.buyVolume.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span style={{ color: '#ef4444', fontWeight: '600' }}>
                  $
                  {data.sellVolume.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span
                  style={{
                    fontWeight: '700',
                    color:
                      data.buyVolume >= data.sellVolume ? '#22c55e' : '#ef4444',
                  }}
                >
                  $
                  {(data.buyVolume - data.sellVolume).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                    signDisplay: 'always',
                  })}
                </span>
              </div>
            ))}
            {/* Overall Total Row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr repeat(5, minmax(120px, 1fr))',
                gap: '12px',
                padding: '16px 20px',
                fontSize: '14px',
                fontWeight: 'bold',
                backgroundColor: '#334155',
                color: 'white',
                textAlign: 'right',
                borderTop: '3px solid #64748b',
                alignItems: 'center',
              }}
            >
              <span style={{ textAlign: 'left' }}>TÜM COINLER</span>
              <span>{overallTotal.totalCount.toLocaleString()}</span>
              <span style={{ color: '#fbbf24' }}>
                $
                {overallTotal.totalVolume.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span style={{ color: '#22c55e' }}>
                $
                {overallTotal.buyVolume.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span style={{ color: '#ef4444' }}>
                $
                {overallTotal.sellVolume.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span
                style={{
                  color:
                    overallTotal.buyVolume >= overallTotal.sellVolume
                      ? '#22c55e'
                      : '#ef4444',
                }}
              >
                $
                {(
                  overallTotal.buyVolume - overallTotal.sellVolume
                ).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                  signDisplay: 'always',
                })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Trades Table */}
      <div
        style={{
          maxWidth: '1800px',
          margin: '0 auto',
          backgroundColor: '#1e293b',
          borderRadius: '16px',
          border: '1px solid #334155',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(to right, #7c3aed, #a855f7)',
            padding: '16px 20px',
            color: 'white',
            fontSize: '16px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '20px' }}>📊</span>
          Filtered Whale Trades (≥${threshold.toLocaleString()})
        </div>

        {/* Table Header with Filters */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              '50px 140px 140px 150px 140px 140px 120px 180px',
            gap: '12px',
            padding: '14px 20px',
            fontSize: '11px',
            color: '#94a3b8',
            fontWeight: '700',
            backgroundColor: '#1e293b',
            borderBottom: '2px solid #334155',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          <span>#</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>Name</span>
            <select
              value={filters.name}
              onChange={(e) => handleFilterChange('name', e.target.value)}
              style={{
                padding: '4px 8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#94a3b8',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              <option value="">All</option>
              {uniqueNames.map((name) => (
                <option key={name} value={name.split('-')[0]}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>Exchange</span>
            <select
              value={filters.exchange}
              onChange={(e) => handleFilterChange('exchange', e.target.value)}
              style={{
                padding: '4px 8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#94a3b8',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              <option value="">All</option>
              {uniqueExchanges.map((exchange) => (
                <option key={exchange} value={exchange}>
                  {exchange}
                </option>
              ))}
            </select>
          </div>
          <span style={{ textAlign: 'right' }}>Quantity</span>
          <span style={{ textAlign: 'right' }}>Price</span>
          <span style={{ textAlign: 'right' }}>Total</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ textAlign: 'center' }}>Side</span>
            <select
              value={filters.side}
              onChange={(e) => handleFilterChange('side', e.target.value)}
              style={{
                padding: '4px 8px',
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#94a3b8',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              <option value="">All</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
          <span style={{ textAlign: 'right' }}>Time</span>
        </div>

        {/* Table Body */}
        <div
          style={{
            maxHeight: '700px',
            overflowY: 'auto',
            backgroundColor: '#0f172a',
          }}
        >
          {filteredTrades.length === 0 ? (
            <div
              style={{
                padding: '60px 20px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '16px',
              }}
            >
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
              <div style={{ fontWeight: '600', marginBottom: '8px' }}>
                {trades.length === 0
                  ? 'Waiting for whale trades...'
                  : 'No trades match your filters'}
              </div>
              <div style={{ fontSize: '14px', opacity: 0.7 }}>
                Min: ${threshold.toLocaleString()} •{' '}
                {isAnyConnected ? 'Live monitoring' : 'No connection'}
              </div>
            </div>
          ) : (
            filteredTrades.map((trade, idx) => (
              <div
                key={`${trade.id}-${idx}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    '50px 140px 140px 150px 140px 140px 120px 180px',
                  gap: '12px',
                  padding: '14px 20px',
                  fontSize: '13px',
                  borderBottom: '1px solid #1e293b',
                  fontFamily: 'monospace',
                  backgroundColor: idx % 2 === 0 ? '#0f172a' : '#1a1f2e',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = '#1e293b')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    idx % 2 === 0 ? '#0f172a' : '#1a1f2e')
                }
              >
                <span style={{ color: '#64748b', fontWeight: '600' }}>
                  {idx + 1}
                </span>
                <span style={{ color: '#60a5fa', fontWeight: '700' }}>
                  {trade.pair}
                </span>
                <span style={{ color: '#a78bfa', fontWeight: '600' }}>
                  {trade.exchange}
                </span>
                <span
                  style={{
                    color: '#e2e8f0',
                    textAlign: 'right',
                    fontWeight: '600',
                  }}
                >
                  {trade.quantity.toFixed(6)}{' '}
                  {trade.symbol
                    .replace('USDT', '')
                    .replace('-USDT', '')
                    .replace('-USD', '')}
                </span>
                <span style={{ color: '#cbd5e1', textAlign: 'right' }}>
                  $
                  {trade.price < 1
                    ? trade.price.toFixed(6)
                    : trade.price.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                </span>
                <span
                  style={{
                    color: '#fbbf24',
                    textAlign: 'right',
                    fontWeight: '700',
                    fontSize: '14px',
                  }}
                >
                  $
                  {trade.total.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <div style={{ textAlign: 'center' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      backgroundColor:
                        trade.side === 'BUY' ? '#166534' : '#991b1b',
                      color: trade.side === 'BUY' ? '#22c55e' : '#ef4444',
                      fontWeight: '700',
                      fontSize: '12px',
                    }}
                  >
                    {trade.side}
                  </span>
                </div>
                <span
                  style={{
                    color: '#94a3b8',
                    textAlign: 'right',
                    fontSize: '12px',
                  }}
                >
                  {formatTime(trade.time)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          maxWidth: '1800px',
          margin: '16px auto 0',
          padding: '14px',
          backgroundColor: '#1e293b',
          borderRadius: '12px',
          textAlign: 'center',
          fontSize: '12px',
          color: '#64748b',
          border: '1px solid #334155',
        }}
      >
        Multi-Exchange WebSocket API • Real-time Whale Trade Monitoring
      </div>
    </div>
  );
}
