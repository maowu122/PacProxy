var VM = require('vm')
  , IP = require('./ip')
  , FS = require('fs')
  , URL = require('url')
  , rHost = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,6}$/i
  , DNS = require('dns')
  , myIP = '127.0.0.1'
  , weekdays = "SUN MON TUES WED THURS FRI SAT".toUpperCase().split(' ')
  , months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".toUpperCase().split(' ')
  , dnsCache = cache()
  , defaultProxy = {type: 'direct'}
  , defaultProxies = [defaultProxy]

DNS.lookup(require('os').hostname(), function (err, add, fam) {
  myIP = add
})

var initSandbox = {

  __myIP: myIP

, dnsDomainIs: function(host, domain) {
    if(!(rHost.test(host) && rHost.test(domain)))
      return false
    if(domain.charAt(0) != '.') domain = '.'+domain
    var p = host.lastIndexOf(domain)
    return (p >= 0 && ((p+domain.length)===host.length))
  }

, shExpMatch: function(str, pattern) {
    var r = new RegExp(pattern.replace(/.|-/, '\\$&').replace('*', '.*'), 'i')
    return r.test(str)
  }

, myIpAddress: function() {
    return __myIP
  }

, isPlainHostName: function(host) {
    return host.indexOf('.') > -1
  }

, localHostOrDomainIs: function(host, domain) {
    return (domain.indexOf(host) === 0) || initSandbox.dnsDomainIs(host, domain)
  }

, dnsDomainLevels: function(host) {
    return host.split('.').length-1
  }

, weekdayRange: function(begin, end) {
    var today = (new Date()).getDay()
    begin = weekdays.indexOf(begin)
    end = weekdays.indexOf(end)
    return today >= begin && today <= end
  }

, dateRange: function(begin, end) {
    var today = (new Date()).getMonth()
    begin = months.indexOf(begin)
    end = months.indexOf(end)
    return today >= begin && today <= end
  }

, timeRange: function(begin ,end) {
    var today = (new Date()).getHour()
    return today >= begin && today <= end
  }

/*
 *
 * DNS related functions
 * Need a sync version
 * DNS module in nodejs do not support sync mode
 *
 */

, dnsResolve: function(host) {
    return dnsCache.get(host) || myIP
  }

, isInNet: function(ip, begin, end) {
    ip = initSandbox.dnsResolve(ip)
    begin = IP.toBuffer(begin).readUInt32BE(0)
    end = IP.toBuffer(end).readUInt32BE(0)
    if(!ip) return false
    ip = IP.toBuffer(ip).readUInt32BE(0)
    return ip >= begin && ip <= end
  }

, isResolvable: function(host) {
    return !!(initSandbox.dnsResolve(host))
  }

}

function parse(proxy) {
  if(!proxy)
    return undefined
  proxy = proxy.toLowerCase().split(/\s|:/)
  if(proxy.length != 3)
    return defaultProxy
  proxy = {
    type: proxy[0]
  , host: proxy[1]
  , port: proxy[2]
  }
  if(proxy.type === 'proxy')
    proxy.type='http'
  return proxy
}

function cache(max) {
  var cache = {}; 
  var count = 0;
  if(!max) max = 1000;
  return {
    get: function(key) {
      var i = cache[key];
      if(i)
        return i;
    }
  , update: function(key, value) {
      var discardKey
        , discard, i
      if(!cache[key]) {
        if(count > max) {
          i=Math.floor(Math.random()*max)
          for(discardKey in cache){
            i--;
            if(i) continue;
            discard = cache[discardKey]
            if(discard && discard.destroy) discard.destroy();
            delete cache[discardKey]
            break
          }   
        } else {
          count++;
        }
      }   
      cache[key] = value
      return value
    }   
  }   
}

exports.create = function(file) {
  var context = VM.createContext(initSandbox)
    , code = FS.readFileSync(file)
    , findCache = cache()
  VM.runInContext(code, context)

  function find(url, host) {
    var proxyList = []
    ;(context.FindProxyForURL(url, host) || "direct").split(";").forEach(function(proxy) {
      ;(proxy = parse(proxy)) && proxyList.push(proxy)
    })
    if(proxyList.length > 0)
      return proxyList
    return defaultProxies
  }

  return {
    find: function(url, clientIP, callback) {
      var host = URL.parse(url).host
        , key = url+'|'+clientIP, ip
        , proxyList = findCache.get(key)
      if(typeof clientIP === 'function') {
        callback = clientIP
        clientIP = myIP
      }
      if(proxyList) {
        console.log('Use cached proxy results, '+JSON.stringify(proxyList))
        callback(proxyList)
      }
      else if(ip = dnsCache.get(host)) {
        console.log('Use cached dns, '+host+'->'+ip)
        proxyList = find(url, host)
        findCache.update(key, proxyList)
        callback(proxyList)
      } else {
        DNS.lookup(host, function(err, ip, famliy) {
          if(err) {
            err.type = 'dns'
          }
          console.log('DNS parse, '+host+'->'+ip)
          dnsCache.update(host, ip)
          proxyList = find(url, host)
          findCache.update(key, proxyList)
          callback(proxyList, err)
        })
      }
    }
  }
}

