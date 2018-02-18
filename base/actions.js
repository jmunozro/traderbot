export async function checkbalance(exchange, symbol) {
    //require("dotenv").config();
    exchange.apiKey = process.env["APIKEY_" + exchange.id];
    exchange.secret = process.env["APISECRET_" + exchange.id];
    let balance = false;
    if (READONLY || !exchange.apiKey || !exchange.secret) {
        return true;//this exchange is for information only
    }
    try {
        let _balance = await exchange.fetchBalance();
        balance = _balance[symbol.split("/")[0]].total > 0;
    } catch (err) {
        balance = true; //maybe next time it will be better
        log("Error checking balance at ", exchange.id, " for ", symbol, ": ", err);
    }
    return balance;
}

export async function cancelStopLoss(exchange, symbol) {
    //require("dotenv").config();
    exchange.apiKey = process.env["APIKEY_" + exchange.id];
    exchange.secret = process.env["APISECRET_" + exchange.id];
    if (READONLY || !exchange.apiKey || !exchange.secret) {
        log("READONLY: ", "Cancelled all orders for: ", symbol, " @ ", exchange.id);
        return;
    }

    let orders = await exchange.fetchOpenOrders(symbol);
    for (let i = 0; i < orders.length; i++) {
        await exchange.cancelOrder(orders[i].id);
        log("Cancelled order: ", orders[i].symbol, " @ ", orders[i].price);
    }
}

export async function setNewStopLoss(exchange, tick) {
    let pairs = await exchange.loadMarkets();
    let min = exchange.markets[tick.symbol].limits.amount.min;
    let precision = exchange.markets[tick.symbol].precision.price;

    let cpy = {};
    cpy.id = tick.iteration + 0.1;
    cpy.t = 'hardsell';
    cpy.e = tick.exchange;
    cpy.m = tick.symbol;
    cpy.a = tick.bid * 0.85;//safe 10% margin to avoid selling in dumps
    cpy.b = tick.bid * 0.95;
    RULES.push(cpy);
    log(cpy.id, tick.exchange, tick.symbol, 'NEW HARDSELL RULE '.magenta, '@', cpy.b);
}

export async function setNewMoon(exchange, tick) {
    //require("dotenv").config();
    exchange.apiKey = process.env["APIKEY_" + exchange.id];
    exchange.secret = process.env["APISECRET_" + exchange.id];
    if (READONLY || !exchange.apiKey || !exchange.secret) {
        log("READONLY: ", "New moon: ", tick.symbol, " @ ", exchange.id);
        return;
    }

    let pairs = await exchange.loadMarkets();
    let precision = exchange.markets[tick.symbol].precision;
    let _balance = await exchange.fetchBalance();
    let amount = _balance[tick.symbol.split("/")[0]].free;
    amount = Number(Math.round(amount + ('e' + precision.amount )) + ('e' + (-1 * precision.amount)));
    let price = Number(Math.round(tick.bid * MOON + ('e' + precision.price )) + ('e' + (-1 * precision.price)));
    await exchange.createLimitSellOrder(tick.symbol, amount, price);
    log(tick.exchange, tick.symbol, ' NEW MOON '.cyan, '@', price);
}

export async function marketSell(exchange, tick) {
    //require("dotenv").config();
    exchange.apiKey = process.env["APIKEY_" + exchange.id];
    exchange.secret = process.env["APISECRET_" + exchange.id];
    if (READONLY || !exchange.apiKey || !exchange.secret) {
        log("READONLY: ", "MarketSell: ", tick.symbol, " @ ", exchange.id);
        return;
    }

    let pairs = await exchange.loadMarkets();
    let precision = exchange.markets[tick.symbol].precision;
    let _balance = await exchange.fetchBalance();
    let amount = _balance[tick.symbol.split("/")[0]].free;
    amount = Number(Math.round(amount + ('e' + precision.amount )) + ('e' + (-1 * precision.amount)));
    let price = Number(Math.round(tick.bid * 0.98 + ('e' + precision.price )) + ('e' + (-1 * precision.price)));
    await exchange.createLimitSellOrder(tick.symbol, amount, price);
    log(tick.exchange, tick.symbol, ' Sold at market price '.cyan, '@', tick.bid);

}