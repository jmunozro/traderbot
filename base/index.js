"use strict";

const ccxt = require('ccxt'), log = require('ololog'), ansi = require('ansicolor').nice, repeat = 900000,
    tableify = require('html-tableify'), MOON=2;

const markets = require('./markets.json');

let RULES = require('./rules.json');

let express = require('express'), app = express(), throttle = require('promise-ratelimit')(4000), tickers = [],
    asTable = require('as-table'), authenticator = require('authenticator');

async function getTicker(symbol, exchange) {
    for (let i = 0; i < repeat; i++) {
        await throttle();
        if (i % 10 === 0) {
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
    }
}

async function checkbalance(exchange, symbol) {
    //require("dotenv").config();
    exchange.apiKey = process.env["APIKEY_" + exchange.id];
    exchange.secret = process.env["APISECRET_" + exchange.id];
    let balance = false;
    try{
        let _balance = await exchange.fetchBalance();
        balance = _balance[symbol.split("/")[0]].total > 0;
    }catch(err){
        log("Error checking balance at ",exchange.id, " for " ,symbol, ": ", err);
    }
    return balance;
}

async function cancelStopLoss(exchange, symbol) {
    //require("dotenv").config();
    exchange.apiKey = process.env["APIKEY_" + exchange.id];
    exchange.secret = process.env["APISECRET_" + exchange.id];

    let orders = await exchange.fetchOpenOrders(symbol);
    for (let i = 0; i < orders.length; i++) {
        await exchange.cancelOrder(orders[i].id);
        log("Cancelled order: ", orders[i].symbol, " @ ", orders[i].price);
    }
}

async function setNewStopLoss(exchange, tick, i) {
    let pairs = await exchange.loadMarkets();
    let min = exchange.markets[tick.symbol].limits.amount.min;
    let precision = exchange.markets[tick.symbol].precision.price;

    let cpy = Object.assign({}, RULES[i]);
    cpy.id = RULES[i].id + 0.01;
    cpy.t = 'hardsell';
    cpy.a = tick.bid * 0.85;//safe 10% margin to avoid selling in dumps
    cpy.b = tick.bid * 0.95;
    RULES.push(cpy);
    log(tick.exchange, tick.symbol, 'NEW HARDSELL RULE '.magenta, '@', cpy.b);
}

async function setNewMoon(exchange, tick) {
    //require("dotenv").config();
    exchange.apiKey = process.env["APIKEY_" + exchange.id];
    exchange.secret = process.env["APISECRET_" + exchange.id];

    let pairs = await exchange.loadMarkets();
    let precision = exchange.markets[tick.symbol].precision;
    let _balance = await exchange.fetchBalance();
    let amount = _balance[tick.symbol.split("/")[0]].free;
    amount = Number(Math.round(amount + ('e'+ precision.amount ))+('e'+(-1*precision.amount)));
    let price = Number(Math.round(tick.bid*MOON + ('e'+ precision.price ))+('e'+(-1*precision.price)));
    await exchange.createLimitSellOrder(tick.symbol, amount, price);
    log(tick.exchange, tick.symbol, ' NEW MOON '.cyan, '@', price);
}

async function marketSell(exchange, tick) {
    //require("dotenv").config();
    exchange.apiKey = process.env["APIKEY_" + exchange.id];
    exchange.secret = process.env["APISECRET_" + exchange.id];

    let pairs = await exchange.loadMarkets();
    let precision = exchange.markets[tick.symbol].precision;
    let _balance = await exchange.fetchBalance();
    let amount = _balance[tick.symbol.split("/")[0]].free;
    amount = Number(Math.round(amount + ('e'+ precision.amount ))+('e'+(-1*precision.amount)));
    let price = Number(Math.round(tick.bid*0.98 + ('e'+ precision.price ))+('e'+(-1*precision.price)));
    await exchange.createLimitSellOrder(tick.symbol, amount, price);
    log(tick.exchange, tick.symbol, ' Sold at market price '.cyan, '@', tick.bid);

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
                    await marketSell(exchange, tick, i);
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
                    await setNewStopLoss(exchange, tick, i); //set new stop loss at tick.bid - 5%
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
    return res.redirect('/ticker');
})
;

app.get('/start', async (req, res) => {
    require("dotenv").config();
	let token = process.env["TOKEN"];
	if (!token || !req.query.token){
		return res.send('Couldnt get token: ' + token + '#' + req.query.token)
	}
    if (authenticator.verifyToken(token, req.query.token)
    ) {
        for (let i = 0, len = markets.length; i < len; i++) {
            try {
                getTicker(markets[i].m, new ccxt[markets[i].e]({enableRateLimit: true}))
            } catch (err) {
                log("ERROR getting ticker for: ".red, markets[i].m, " ", markets[i].e, " => ", err);
            }
        }
        return res.redirect('/ticker')
    }
    else {
        return res.send('invalid token')
    }
})
;

app.get('/stop', async (req, res) => {
    //require("dotenv").config();
	let token = process.env["TOKEN"];
	if (!token || !req.query.token){
		return res.send('Couldnt get token: ' + token + '#' + req.query.token)
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
