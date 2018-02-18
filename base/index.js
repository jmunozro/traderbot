"use strict";

import { checkbalance, cancelStopLoss, setNewStopLoss, setNewMoon, marketSell, MOON } from 'actions';

const ccxt = require('ccxt'), log = require('ololog'), ansi = require('ansicolor').nice, repeat = 900000,
    tableify = require('html-tableify');

const markets = require('./config/markets.json');

let RULES = require('./config/rules.json');

let express = require('express'), app = express(), throttle = require('promise-ratelimit')(4000), tickers = [],
    asTable = require('as-table'), authenticator = require('authenticator'), READONLY = true, RUNNING = false;

async function getTicker(symbol, exchange) {
    for (let i = 1; i < repeat; i++) {
        try {
            await throttle();
            if (i % 13 === 0) {
                let hasBalance = await checkbalance(exchange, symbol);
                if (!hasBalance) {
                    log("No more ", symbol, " in ", exchange.id);
                    return;//no more money!
                }
            }
            let ticker = await exchange.fetchTicker(symbol);
            let idx = tickers.findIndex(x => {
                    return x.exchange === exchange.id && x.symbol === symbol
                }
            );
            let tick = {
                iteration: i,
                exchange: exchange.id,
                symbol: symbol,
                bid: ticker['bid'],
                ask: ticker['ask'],
                last: ticker['last'],
                datetime: ticker['datetime']
            };
            if (idx >= 0) {
                tickers[idx] = tick
            } else {
                tickers.push(tick)
            }
            tickers.sort((a, b) => {
                return (a.datetime < b.datetime
                )
                    ? 1 : -1;
            });
            //log(i, exchange.id.green, ticker['datetime'], symbol.yellow, 'bid'.green, ticker['bid'], 'ask'.red, ticker['ask'], 'last', ticker['last']);
            await checkRules(exchange, tick);
            RULES.sort((a, b) => {
                return b.percent - a.percent;
            });
        } catch (err) {
            log("Error getTicker ", exchange.id, " for ", symbol, ": ", err);
        }
    }
}

async function checkRules(exchange, tick) {
    for (let i = 0, len = RULES.length; i < len; i++) {
        if (tick.exchange === RULES[i].e && tick.symbol === RULES[i].m) {
            if (RULES[i].t === 'hardsell') {
                RULES[i].percent = RULES[i].b / tick.bid;
                RULES[i].price = tick.bid;
                if (RULES[i].percent >= 1) {
                    log(tick.exchange, tick.symbol, 'HARD SELL RULE MATCHED!!'.red, '@', tick.bid, "(", RULES[i].a, ",", RULES[i].b, ")");
                    await cancelStopLoss(exchange, tick.symbol);
                    await marketSell(exchange, tick, RULES[i].amount?RULES[i].amount:999999);
                }
            }
            else if (RULES[i].t === 'moon') {
                RULES[i].percent = tick.bid / RULES[i].a;
                RULES[i].price = tick.bid;
                if (RULES[i].percent >= 1) {
                    log(tick.exchange, tick.symbol, 'MOON SELL RULE MATCHED!!'.red, '@', tick.bid, "(", RULES[i].a, ",", RULES[i].b, ")");
                    await cancelStopLoss(exchange, tick.symbol);
                    await marketSell(exchange, tick, RULES[i].amount?RULES[i].amount:999999);
                }
            }
            else if (RULES[i].t === 'sell') {
                RULES[i].percent = tick.bid / RULES[i].a;
                RULES[i].price = tick.bid;
                if (RULES[i].percent >= 1) {
                    log(tick.exchange, tick.symbol, 'SELL RULE MATCHED!!'.red, '@', tick.bid, "(", RULES[i].a, ",", RULES[i].b, ")");
                    RULES[i].a = tick.bid * 1.05;
                    log(tick.exchange, tick.symbol, 'NEW SELL RULE '.green, '@', RULES[i].a);
                    await cancelStopLoss(exchange, tick.symbol);
                    await setNewMoon(exchange, tick);
                    await setNewStopLoss(exchange, tick, RULES[i].amount?RULES[i].amount:999999); //set new stop loss at tick.bid - 5%
                }
            }
            /*else if (RULES[i].t === 'buy') {
                RULES[i].percent = RULES[i].b / tick.ask;
                RULES[i].price = tick.ask;
                if (RULES[i].percent >= 1) {
                    log(tick.exchange, tick.symbol, 'BUY RULE MATCHED!!'.red, '@', tick.ask, "(", RULES[i].a, ",", RULES[i].b, ")");
                    RULES[i].b = tick.ask * 0.95;
                    log(tick.exchange, tick.symbol, 'NEW BUY RULE '.green, '@', RULES[i].b);
                    await cancelStopLoss(exchange, tick.symbol);
                    await setNewFloor(exchange, tick);
                    await setNewHardBuy(exchange, tick, i);
                }
            }*/
        }
    }
}

// respond with "hello world" when a GET request is made to the homepage
app.get('/', async (req, res) => {
    if (!RUNNING) {
        RUNNING = true;
        for (let i = 0, len = markets.length; i < len; i++) {
            try {
                getTicker(markets[i].m, new ccxt[markets[i].e]({enableRateLimit: true}))
            } catch (err) {
                log("ERROR getting ticker for: ".red, markets[i].m, " ", markets[i].e, " => ", err);
            }
        }
    }
    return res.redirect('/ticker');
})
;

app.get('/start', async (req, res) => {
    require("dotenv").config();
    let token = process.env["TOKEN"];
    if (!token || !req.query.token) {
        return res.send('Couldnt get token: #' + req.query.token)
    }
    if (authenticator.verifyToken(token, req.query.token)) {
        READONLY = false;
    } else {
        return res.send('invalid token')
    }
})
;

app.get('/stop', async (req, res) => {
    //require("dotenv").config();
    let token = process.env["TOKEN"];
    if (!token || !req.query.token) {
        return res.send('Couldnt get token: #' + req.query.token)
    }
    if (authenticator.verifyToken(token, req.query.token)
    ) {
        process.exit(1);
    }
    return res.send('invalid token');
})
;

app.get('/ticker', async (req, res) => {
    //res.send(asTable(tickers))
    res.send(tableify(tickers, {
        tidy: false
    }) + tableify(RULES, {
        tidy: false
    })
    );
})
;

app.listen(3000, () => console.log('CCTX app listening on port 3000!')
)
;
