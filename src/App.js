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
            side: trade.S === 'Sell' ?
              'SELL' : 'BUY',
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
            side: trade.side === 'sell' ?
              'SELL' : 'BUY',
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
  // YENİ: Coin filtre metni state'i
  const [filterText, setFilterText] = useState(''); 

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
          sellCount: current.sellCount + (trade.side === 'SELL' ?
            1 : 0),
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

  // YENİ: Filtreleme mantığı uygulanıyor
  const lowerCaseFilter = filterText.toLowerCase();

  const filteredTopBuyers = Object.values(coinData)
    .sort((a, b) => b.buyVolume - a.buyVolume)
    .filter(coin => coin.coin.toLowerCase().includes(lowerCaseFilter)) // Filtreleme
    .slice(0, 100);

  const filteredTopSellers = Object.values(coinData)
    .sort((a, b) => b.sellVolume - a.sellVolume)
    .filter(coin => coin.coin.toLowerCase().includes(lowerCaseFilter)) // Filtreleme
    .slice(0, 100);

  const topBuyers = Object.values(coinData) // Eski tanımlamaları koruduk, ancak tablolarda filtered olanları kullanacağız.
    .sort((a, b) => b.buyVolume - a.buyVolume)
    .slice(0, 100);

  const topSellers = Object.values(coinData) // Eski tanımlamaları koruduk, ancak tablolarda filtered olanları kullanacağız.
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

  const styles = {
    container: {
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
      padding: '20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    header: {
      maxWidth: '1800px',
      margin: '0 auto 24px',
      background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
      borderRadius: '20px',

      padding: '30px',
      border: '1px solid #475569',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    },
    title: {
      fontSize: '42px',
      fontWeight: 'bold',
      color: 'white',
      marginBottom: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    },
    statusBar: {
      display: 'flex',

      alignItems: 'center',
      gap: '16px',
      fontSize: '14px',
      marginBottom: '24px',
    },
    statusDot: {
      width: '10px',
      height: '10px',
      borderRadius: '50%',
      animation: 'pulse 2s infinite',
    },
    controls: {
      display: 'flex',
      gap: '16px',
      alignItems: 'flex-end',
      flexWrap:
        'wrap',
      marginBottom: '24px',
    },
    input: {
      padding: '12px 16px',
      backgroundColor: '#0f172a',
      border: '2px solid #475569',
      borderRadius: '12px',
      color: 'white',
      fontSize: '16px',
      fontWeight: '600',
      width: '160px',
    },
    button: {
      padding: '12px 24px',
      background: 'linear-gradient(135deg,',
      border: 'none',
      borderRadius: '12px',
      color: 'white',
      fontSize: '15px',
      fontWeight: 'bold',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(220, 38, 38, 0.4)',
      transition: 'all 0.3s',
    },
    exchangeSelector: {
      padding: '20px',
      backgroundColor: '#0f172a',
      borderRadius: '16px',

      border: '1px solid #334155',
      marginBottom: '24px',
    },
    exchangeButton: {
      padding: '12px 20px',
      border: 'none',
      borderRadius: '10px',
      color: 'white',
      fontSize: '14px',
      fontWeight: 'bold',
      cursor: 'pointer',
      transition: 'all 0.3s',
      marginRight: '12px',
      marginBottom: '8px',
    },

    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: '16px',
    },
    statCard: {
      padding: '20px',
      borderRadius: '16px',
      border: '2px solid',
    },
    mainGrid: {
      maxWidth: '1800px',
      margin: '0 auto',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',

      gap: '24px',
    },
    tableContainer: {
      borderRadius: '20px',
      overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      border: '2px solid',
    },
    tableHeader: {
      padding: '20px 24px',
      color: 'white',
      fontSize: '20px',
      fontWeight: 'bold',
      display: 'flex',
      alignItems: 'center',

      gap: '10px',
    },
    tableColumnHeader: {
      padding: '16px 20px',
      fontSize: '12px',
      fontWeight: 'bold',
      letterSpacing: '1px',
      display: 'grid',
      gridTemplateColumns: '80px 1fr 1fr 1fr',
      gap: '16px',
    },
    tableRow: {
      display: 'grid',
      gridTemplateColumns: '80px 1fr 1fr 1fr',
      gap: '16px',

      padding: '16px 20px',
      fontSize: '15px',
      borderBottom: '1px solid',
      transition: 'background-color 0.2s',
      cursor: 'pointer',
    },
    scrollContainer: {
      maxHeight: '600px',
      overflowY: 'auto',
    },
    emptyState: {
      textAlign: 'center',
      padding: '80px 20px',
      color: '#64748b',
    },
    footer: {

      maxWidth: '1800px',
      margin: '24px auto 0',
      textAlign: 'center',
      color: '#64748b',
      fontSize: '14px',
      padding: '20px',
    },
  };

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        button:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.3);

        }
        input:focus {
          outline: none;
          border-color: #8b5cf6;
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
        }
      `}</style>

      <div style={styles.header}>
        <h1 style={styles.title}>
          <span style={{ fontSize: '50px' }}>🐋</span>

          Premium Whale Tracker
        </h1>

        <div style={styles.statusBar}>
          <span style={{
            color: isConnected ? '#10b981' : '#ef4444',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',

            fontWeight: 'bold'
          }}>
            <span style={{
              ...styles.statusDot,
              backgroundColor: isConnected ?
                '#10b981' : '#ef4444'
            }}></span>
            {isConnected ?
              'LIVE' : 'DISCONNECTED'}
          </span>
          <span style={{ color: '#64748b' }}>•</span>
          <span style={{ color: '#94a3b8' }}>{selectedExchanges.length} Active Exchanges</span>
          <span style={{ color: '#64748b' }}>•</span>
          <span style={{ color: '#94a3b8' }}>Top 100 Futures</span>
        </div>

        <div style={styles.controls}>
          {/* 1. MIN AMOUNT (USD) */}
          <div>

            <label style={{
              display: 'block',
              color: '#94a3b8',
              fontSize: '11px',
              fontWeight: 'bold',
              marginBottom: '8px',

              letterSpacing: '1px'
            }}>
              MIN AMOUNT (USD)
            </label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}

              style={styles.input}
            />
          </div>

          {/* 2. YENİ: COIN FİLTRESİ */}
          <div>
            <label style={{
              display: 'block',
              color: '#94a3b8',
              fontSize: '11px',
              fontWeight: 'bold',
              marginBottom: '8px',
              letterSpacing: '1px'
            }}>
              COIN FİLTRESİ
            </label>
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={styles.input}
              placeholder="BTC, ETH, vb."
            />
          </div>

          {/* 3. RESET BUTONU */}
          <button
            onClick={() => setCoinData({})}
            style={styles.button}
            onMouseEnter={(e) => {
              e.target.style.background
                = 'linear-gradient(135deg, #b91c1c 0%, #991b1b 100%)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)';
            }}
          >
            🔄 RESET
          </button>
        </div>

        <div style={styles.exchangeSelector}>
          <div style={{
            color: '#94a3b8',
            fontSize: '12px',

            fontWeight: 'bold',
            marginBottom: '16px',
            letterSpacing: '1px'
          }}>
            SELECT EXCHANGES
          </div>
          <div>
            {Object.keys(EXCHANGES).map((ex) => {
              const isSelected
                = selectedExchanges.includes(ex);
              return (
                <button
                  key={ex}
                  onClick={() => {
                    setSelectedExchanges((prev) =>

                      prev.includes(ex) ? prev.filter((e) => e !== ex) : [...prev, ex]
                    );
                  }}
                  style={{
                    ...styles.exchangeButton,

                    background: isSelected
                      ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)'
                      : '#334155',
                    boxShadow: isSelected

                      ?
                      '0 4px 12px rgba(139, 92, 246, 0.4)'
                      : 'none',
                  }}
                >
                  {isSelected && '✓ '}{ex}

                </button>
              );
            })}
          </div>
        </div>

        <div style={styles.statsGrid}>
          <div style={{
            ...styles.statCard,
            background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
            borderColor: '#10b981',
          }}>

            <div style={{ color: '#6ee7b7', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>
              BUY VOLUME
            </div>
            <div style={{ color: 'white', fontSize: '32px', fontWeight: 'bold' }}>
              ${(totalStats.totalBuyVolume / 1000000).toFixed(2)}M
            </div>
            <div
              style={{ color: '#a7f3d0', fontSize: '14px', marginTop: '8px' }}>
              {totalStats.totalBuyCount.toLocaleString()} trades
            </div>
          </div>

          <div style={{
            ...styles.statCard,
            background: 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)',
            borderColor: '#ef4444',

          }}>
            <div style={{ color: '#fca5a5', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>
              SELL VOLUME
            </div>
            <div style={{ color: 'white', fontSize: '32px', fontWeight: 'bold' }}>
              ${(totalStats.totalSellVolume / 1000000).toFixed(2)}M

            </div>
            <div style={{ color: '#fecaca', fontSize: '14px', marginTop: '8px' }}>
              {totalStats.totalSellCount.toLocaleString()} trades
            </div>
          </div>

          <div style={{
            ...styles.statCard,
            background: 'linear-gradient(135deg, #1e3a8a 0%',
            borderColor: '#3b82f6',
          }}>
            <div style={{ color: '#93c5fd', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>
              NET FLOW
            </div>
            <div style={{

              color: totalStats.totalBuyVolume > totalStats.totalSellVolume ? '#10b981' : '#ef4444',
              fontSize: '32px',
              fontWeight: 'bold'
            }}>
              ${Math.abs((totalStats.totalBuyVolume - totalStats.totalSellVolume) / 1000000).toFixed(2)}M
            </div>
            <div style={{ color: '#bfdbfe', fontSize: '14px', marginTop: '8px'
            }}>
              {totalStats.totalBuyVolume > totalStats.totalSellVolume ?
                'Buy pressure' : 'Sell pressure'}
            </div>
          </div>

          <div style={{
            ...styles.statCard,
            background: 'linear-gradient(135deg, #78350f 0%, #92400e 100%)',
            borderColor: '#f59e0b',
          }}>

            <div style={{ color: '#fcd34d', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>
              ACTIVE COINS
            </div>
            <div style={{ color: 'white', fontSize: '32px', fontWeight: 'bold' }}>
              {Object.keys(coinData).length}
            </div>
            <div style={{ color: '#fde68a',
              fontSize: '14px', marginTop: '8px' }}>
              Tracked assets
            </div>
          </div>
        </div>
      </div>

      <div style={styles.mainGrid}>
        {/* Buy Volume Table */}
        <div style={{
          ...styles.tableContainer,

          borderColor: '#10b981',
          background: 'linear-gradient(180deg, rgba(6, 78, 59, 0.2) 0%, #0f172a 100%)',
        }}>
          <div style={{
            ...styles.tableHeader,
            background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
          }}>
            📈 TOP 100 BUY VOLUME

          </div>
          <div style={{
            ...styles.tableColumnHeader,
            backgroundColor: '#1e293b',
            color: '#94a3b8',
            borderBottom: '2px solid #334155',
          }}>
            <span>RANK</span>

            <span>COIN</span>
            <span style={{ textAlign: 'right' }}>VOLUME</span>
            <span style={{ textAlign: 'right' }}>TRADES</span>
          </div>
          <div style={styles.scrollContainer}>
            {filteredTopBuyers.length === 0 ? // <-- DEĞİŞİKLİK
              (
                <div style={styles.emptyState}>
                  <div style={{ fontSize: '60px', marginBottom: '20px' }}>⏳</div>
                  <div style={{ fontWeight: 'bold', fontSize: '18px' }}>Waiting for whale trades...</div>
                  <div style={{ marginTop: '8px', fontSize: '14px' }}>Min: ${threshold.toLocaleString()}</div>
                </div>

              ) : (
                filteredTopBuyers.map((coin, idx) => ( // <-- DEĞİŞİKLİK
                  <div
                    key={coin.coin}
                    style={{

                      ...styles.tableRow,
                      backgroundColor: idx % 2 === 0 ? '#0f172a' : '#1a1f2e',
                      borderBottomColor: '#1e293b',
                    }}
                    onMouseEnter={(e) => {

                      e.currentTarget.style.backgroundColor = '#064e3b';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#0f172a' : '#1a1f2e';
                    }}

                  >
                    <span style={{ color: '#64748b', fontWeight: 'bold' }}>#{idx + 1}</span>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '16px' }}>
                      {coin.coin}

                    </span>
                    <span style={{ color: 'white', fontWeight: 'bold', textAlign: 'right' }}>
                      ${(coin.buyVolume / 1000).toFixed(1)}K
                    </span>
                    <span style={{ color: '#6ee7b7', textAlign: 'right' }}>

                      {coin.buyCount}
                    </span>
                  </div>
                ))
              )}
          </div>
        </div>


        {/* Sell Volume Table */}
        <div style={{
          ...styles.tableContainer,
          borderColor: '#ef4444',
          background: 'linear-gradient(180deg, rgba(127, 29, 29, 0.2) 0%, #0f172a 100%)',
        }}>
          <div style={{
            ...styles.tableHeader,
            background: 'linear-gradient(135deg, #dc2626 0%, #ef4444',
          }}>
            📉 TOP 100 SELL VOLUME
          </div>
          <div style={{
            ...styles.tableColumnHeader,
            backgroundColor: '#1e293b',
            color: '#94a3b8',
            borderBottom: '2px solid',
          }}>
            <span>RANK</span>
            <span>COIN</span>
            <span style={{ textAlign: 'right' }}>VOLUME</span>
            <span style={{ textAlign: 'right' }}>TRADES</span>
          </div>
          <div style={styles.scrollContainer}>
            {filteredTopSellers.length // <-- DEĞİŞİKLİK
              === 0 ? (
                <div style={styles.emptyState}>
                  <div style={{ fontSize: '60px', marginBottom: '20px' }}>⏳</div>
                  <div style={{ fontWeight: 'bold', fontSize: '18px' }}>Waiting for whale trades...</div>
                  <div style={{ marginTop: '8px', fontSize: '14px' }}>Min: ${threshold.toLocaleString()}</div>

                </div>
              ) : (
                filteredTopSellers.map((coin, idx) => ( // <-- DEĞİŞİKLİK
                  <div
                    key={coin.coin}
                    style={{

                      ...styles.tableRow,
                      backgroundColor: idx % 2 === 0 ? '#0f172a' : '#1a1f2e',
                      borderBottomColor: '#1e293b',
                    }}
                    onMouseEnter={(e) => {

                      e.currentTarget.style.backgroundColor = '#7f1d1d';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#0f172a' : '#1a1f2e';

                    }}
                  >
                    <span style={{ color: '#64748b', fontWeight: 'bold' }}>#{idx + 1}</span>
                    <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '16px' }}>
                      {coin.coin}

                    </span>
                    <span style={{ color: 'white', fontWeight: 'bold', textAlign: 'right' }}>
                      ${(coin.sellVolume / 1000).toFixed(1)}K
                    </span>
                    <span style={{ color: '#fca5a5', textAlign: 'right' }}>

                      {coin.sellCount}
                    </span>
                  </div>
                ))
              )}
          </div>
        </div>

      </div>

      <div style={styles.footer}>
        Premium Multi-Exchange Whale Tracker • Real-time Futures Monitoring • Last Update: {lastUpdate.toLocaleTimeString()}
      </div>
    </div>
  );
}
