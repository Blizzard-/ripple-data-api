var winston = require('winston'),
  moment    = require('moment'),
  ripple    = require('ripple-lib'),
  async     = require('async');

/**
 *  totalValueSent: 
 * 
 *  total of amounts sent or exchanged from any wallet, either through a payment 
 *  or an "offerCreate" that exercises another offer, for a curated list of 
 *  currency/issuers and XRP, normalized to a specified currency
 *
 *  request : 
 *
 * {
 *    startTime : (any momentjs-readable date), // optional, defaults to 1 day before end time
 *    endTime   : (any momentjs-readable date), // optional, defaults to now
 *    exchange  : {                             // optional, defaults to XRP
 *      currency  : (XRP, USD, BTC, etc.),         
 *      issuer    : "rAusZ...."                 // optional, required if currency != XRP
 *    }
 * }
 *
 * response : 
 *
 * {
 *    startTime    : "2014-03-13T20:39:26+00:00",       //period start
 *    endTime      : "2014-03-14T20:39:26+00:00",       //period end
 *    exchange     : {
 *      currency : "USD",                               //exchange currency
 *      issuer   : "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B"  //exchange issuer
 *    },
 *    exchangeRate : 0.014301217579817786,              //exchange rate
 *    total        : 726824.6504823748,                 //total value sent
 *    count        : 6040,                              //number of transactions
 *    components   : [                                  //list of component currencies
 *      {
 *        currency        : "USD",
 *        issuer          : "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B",
 *        amount          : 27606.296227064257,
 *        count           : 51,
 *        rate            : 1,
 *        convertedAmount : 27606.296227064257
 *      },
 *      .
 *      .
 *      .
 *      .
 *    ]
 * }
 * 
 *
    curl -H "Content-Type: application/json" -X POST -d '{
    "exchange"  : {"currency": "USD", "issuer" : "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B"}
  
    }' http://localhost:5993/api/totalValueSent 
    
 
 */

function totalValueSent( req, res ) {

  var cachKey, viewOpts = {};
  var ex = req.body.exchange || {currency:"XRP"};
  
  if (typeof ex != 'object')               return res.send(500, {error: 'invalid exchange currency'});
  else if (!ex.currency)                   return res.send(500, {error: 'exchange currency is required'});
  else if (typeof ex.currency != 'string') return res.send(500, {error: 'invalid exchange currency'});
  else if (ex.currency.toUpperCase() != "XRP" && !ex.issuer)
    return res.send(500, {error: 'exchange issuer is required'});
  else if (ex.currency == "XRP" && ex.issuer)
    return res.send(500, {error: 'XRP cannot have an issuer'});
 
 
  //all currencies we are going to check    
  var currencies = [ 
    {currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B'},  //Bitstamp USD
    {currency: 'BTC', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B'},  //Bitstamp BTC
    {currency: 'USD', issuer: 'rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q'}, //Snapswap USD
    {currency: 'CNY', issuer: 'rnuF96W4SZoCJmbHYBFoJZpR8eCaxNvekK'}, //RippleCN CNY
    {currency: 'CNY', issuer: 'razqQKzJRdB4UxFPWf5NEpEG3WMkmwgcXA'}, //RippleChina CNY
    {currency: 'XRP'}
  ];
 
  
  //XRP conversion rates for each of the currencies - these must be in the same order as above  
  var conversionPairs = [
    {
      //XRP value of Bitstamp USD
      base  : {currency: 'XRP'},
      trade : {currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B'}
    },
    {
      //XRP value of Bitstamp BTC
      base  : {currency: 'XRP'},
      trade : {currency: 'BTC', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B'}
    },
    {
      //XRP value of Snapswap USD
      base  : {currency: 'XRP'},
      trade : {currency: 'USD', issuer: 'rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q'}
    },
    {
      //XRP value of RippleCN CNY
      base  : {currency: 'XRP'},
      trade : {currency: 'CNY', issuer: 'rnuF96W4SZoCJmbHYBFoJZpR8eCaxNvekK'}
    },
    {
      //XRP value of RippleChina CNY
      base: {currency: 'XRP'},
      trade: {currency: 'CNY', issuer: 'razqQKzJRdB4UxFPWf5NEpEG3WMkmwgcXA'}
    }
  ];
  
  
  //parse startTime and endTime
  var startTime, endTime;

  if (!req.body.startTime && !req.body.endTime) {

    startTime = moment.utc().subtract('hours', 24);
    endTime   = moment.utc();

  } else if (req.body.startTime && req.body.endTime && moment(req.body.startTime).isValid() && moment(req.body.endTime).isValid()) {

    if (moment(req.body.startTime).isBefore(moment(req.body.endTime))) {
      startTime = moment.utc(req.body.startTime);
      endTime   = moment.utc(req.body.endTime);
    } else {
      endTime   = moment.utc(req.body.startTime);
      startTime = moment.utc(req.body.endTime);
    }

  } else if (req.body.endTime && moment(req.body.endTime).isValid()) {
    
    endTime   = moment.utc(req.body.endTime);
    startTime = moment.utc(req.body.endTime).subtract('hours', 24);
    
  } else {

    if (!moment(req.body.startTime).isValid()) {
      winston.error('invalid startTime: ' + req.body.startTime + ' is invalid at: ' + moment(req.body.startTime).invalidAt());
      res.send(500, { error: 'invalid startTime: ' + req.body.startTime + ' is invalid at: ' + moment(req.body.startTime).invalidAt() });
    }

    if (!moment(req.body.endTime).isValid()) {
      winston.error('invalid endTime: ' + req.body.endTime + ' is invalid at: ' + moment(req.body.endTime).invalidAt());
      res.send(500, { error: 'invalid endTime: ' + req.body.endTime + ' is invalid at: ' + moment(req.body.endTime).invalidAt() });
    }

    return;
  }  
   
  if (endTime.isBefore(startTime)) { //swap times
    tempTime  = startTime;
    startTime = endTime;
    endTime   = tempTime;
  } else if (endTime.isSame(startTime)) {
    return res.send(500, { error: 'please provide 2 distinct times'});
  }
    
  if (CACHE) {
    cacheKey = "TVS:" + ex.currency;
    if (ex.issuer) cacheKey += "."+ex.issuer;
    if (endTime.unix()==moment.utc().unix()) { //live update request
      cacheKey += ":live:"+endTime.diff(startTime, "seconds");
    } else {
      cacheKey += ":hist:"+startTime.unix()+":"+endTime.unix();
    }
 
    redis.get(cacheKey, function(err, response){
      if (err) winston.error("cache error:", err);
      if (response) res.send(JSON.parse(response));  
      else fromCouch();
    });
    
  } else fromCouch();
  
  function fromCouch() {  
    //prepare results to send back
    var response = {
      startTime : startTime.format(),
      endTime   : endTime.format(),
      exchange  : ex,  
    };
   
    
    // Mimic calling valueSent for each asset pair
    async.map(currencies, function(assetPair, asyncCallbackPair){
  
      require("./valueSent")({
        body: {
          currency  : assetPair.currency,
          issuer    : assetPair.issuer,
          startTime : startTime,
          endTime   : endTime,
        }
      }, {
        send: function(data) {

          if (data.error) return asyncCallbackPair(data.error);
  
          if (data && data.results && data.results.length > 1) {
            assetPair.amount = data.results[1][1]; 
            assetPair.count  = data.results[1][2];
          } else {
            assetPair.amount = 0;
            assetPair.count  = 0;
          }
          
          asyncCallbackPair(null, assetPair);
        }
      });
  
    }, function(err, currencies) {

      if (err) return res.send(500, { error: err });
  
      getExchangeRates(startTime, endTime, conversionPairs, function(err, rates){
        if (err) return res.send(500, { error: err });
        
        var finalRate = ex.currency == "XRP" ? 1 : null;
        
        rates.forEach(function(pair, index){
  
          currencies[index].rate            = pair.rate; 
          currencies[index].convertedAmount = pair.rate ? currencies[index].amount / pair.rate : 0;
        
          //check to see if the pair happens to be the
          //final conversion currency we are looking for
          if (pair.trade.currency == ex.currency &&
              pair.trade.issuer   == ex.issuer) finalRate = pair.rate;
        });
        
        if (finalRate) finalize();
        else {
          getConversion({
            startTime : startTime,
            endTime   : endTime,
            currency  : ex.currency,
            issuer    : ex.issuer
          }, function(err,rate){
            if (err) return res.send(500, { error: err });
            finalRate = rate;
            finalize(); 
          });
        }
             
        function finalize () {
          var total = 0, count = 0;
          currencies.forEach(function(currency, index) {
  
            if (currency.currency == "XRP") {
              currency.rate            = 1; //for XRP
              currency.convertedAmount = currency.amount;
            }
            
            currency.convertedAmount *= finalRate;
            currency.rate = finalRate / currency.rate;
            total += currency.convertedAmount;
            count += currency.count;
          });
        
          response.exchangeRate = finalRate;
          response.total        = total;
          response.count        = count;
          response.components   = currencies;
          
          res.send(response);   
          if (CACHE) {
            redis.set(cacheKey, JSON.stringify(response), function(err, res){
              if (err) winston.error("cache error:", err);
              else {
                redis.expire(cacheKey, 60); //expire in 60 seconds  
                if (DEBUG) winston.info("TVS cached");
              }
            });
          }      
        }  
      });
    });
  }   



  /*
   * get exchange rates for the listed currencies
   * 
   */
  function getExchangeRates (startTime, endTime, pairs, callback) {
    
    // Mimic calling offersExercised for each asset pair
    async.mapLimit(pairs, 10, function(assetPair, asyncCallbackPair){
  
      require("./offersExercised")({
        body: {
          base  : assetPair.base,
          trade : assetPair.trade,
          startTime : startTime,
          endTime   : endTime,
          timeIncrement: 'all'
        }
      }, {
        send: function(data) {
  
          if (data.error) return asyncCallbackPair(data.error);
  
          if (data && data.length > 1) 
                assetPair.rate = data[1][8]; // vwavPrice
          else  assetPair.rate = 0;
          
          asyncCallbackPair(null, assetPair);
        }
      });
  
    }, function(err, results){
      if (err) return callback(err);
      return callback(null, results);
    });  
  }
  
  
  
  /*
   * get XRP to specified currency conversion
   * 
   */
  function getConversion (params, callback) {
    
    // Mimic calling offersExercised 
    require("./offersExercised")({
      body: {
        base      : {currency:"XRP"},
        trade     : {currency:params.currency,issuer:params.issuer},
        startTime : params.startTime,
        endTime   : params.endTime,
        timeIncrement : 'all'
      }
    }, {
      send: function(data) {
  
        if (data.error) return callback(data.error);
        if (data && data.length > 1) 
             callback(null,data[1][8]); // vwavPrice
        else callback({error:"cannot determine exchange rate"});
      }
    });    
  }
}

module.exports = totalValueSent;
