  /*
   * EventSource polyfill version {{VERSION}}
   * Supported by sc AmvTek srl
   * :email: devel@amvtek.com
   */
;(function (global) {

    if (global.EventSource && !global._eventSourceImportPrefix){
        return;
    }

    var evsImportName = (global._eventSourceImportPrefix||'')+"EventSource";

    var EventSource = function (url, options) {

        if (!url || typeof url != 'string') {
            throw new SyntaxError('Not enough arguments');
        }

        this.URL = url;
        this.setOptions(options);
        var evs = this;
        setTimeout(function(){evs.poll()}, 0);
    };

    EventSource.prototype = {

        CONNECTING: 0,

        OPEN: 1,

        CLOSED: 2,

        defaultOptions: {

            loggingEnabled: false,

            loggingPrefix: "eventsource",

            interval: 500, // milliseconds

            bufferSizeLimit: 256*1024, // bytes

            silentTimeout: 300000, // milliseconds

            getArgs:{
                'evs_buffer_size_limit': 256*1024
            },

            xhrHeaders:{
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Requested-With': 'XMLHttpRequest'
            }
        },

        setOptions: function(options){

            var defaults = this.defaultOptions;
            var option;

            // set all default options...
            for (option in defaults){

                if ( defaults.hasOwnProperty(option) ){
                    this[option] = defaults[option];
                }
            }

            // override with what is in options
            for (option in options){

                if (option in defaults && options.hasOwnProperty(option)){
                    this[option] = options[option];
                }
            }

            // if getArgs option is enabled
            // ensure evs_buffer_size_limit corresponds to bufferSizeLimit
            if (this.getArgs && this.bufferSizeLimit) {

                this.getArgs['evs_buffer_size_limit'] = this.bufferSizeLimit;
            }

            // if console is not available, force loggingEnabled to false
            if (typeof console === "undefined" || typeof console.log === "undefined") {

                this.loggingEnabled = false;
            }
        },

        log: function(message) {

            if (this.loggingEnabled) {

                console.log("[" + this.loggingPrefix +"]:" + message)
            }
        },

        poll: function() {

            try {

                if (this.readyState == this.CLOSED) {
                    return;
                }

                this.cleanup();
                this.readyState = this.CONNECTING;
                this.cursor = 0;
                this.cache = '';
                this._xhr = new this.XHR(this);
                this.resetNoActivityTimer();

            }
            catch (e) {

                // in an attempt to silence the errors
                this.log('There were errors inside the pool try-catch');
                this.dispatchEvent('error', { type: 'error', data: e.message });
            }
        },

        pollAgain: function (interval) {

            // schedule poll to be called after interval milliseconds
            var evs = this;
            evs.readyState = evs.CONNECTING;
            evs.dispatchEvent('error', {
                type: 'error',
                data: "Reconnecting "
            });
            this._pollTimer = setTimeout(function(){evs.poll()}, interval||0);
        },


        cleanup: function() {

            this.log('evs cleaning up')

            if (this._pollTimer){
                clearInterval(this._pollTimer);
                this._pollTimer = null;
            }

            if (this._noActivityTimer){
                clearInterval(this._noActivityTimer);
                this._noActivityTimer = null;
            }

            if (this._xhr){
                this._xhr.abort();
                this._xhr = null;
            }
        },

        resetNoActivityTimer: function(){

            if (this.silentTimeout){

                if (this._noActivityTimer){
                    clearInterval(this._noActivityTimer);
                }
                var evs = this;
                this._noActivityTimer = setTimeout(
                        function(){ evs.log('Timeout! silentTImeout:'+evs.silentTimeout); evs.pollAgain(); },
                        this.silentTimeout
                        );
            }
        },

        close: function () {

            this.readyState = this.CLOSED;
            this.log('Closing connection. readyState: '+this.readyState);
            this.cleanup();
        },

        _onxhrdata: function() {

            var request = this._xhr;

            if (request.isReady() && !request.hasError() ) {
                // reset the timer, as we have activity
                this.resetNoActivityTimer();

                // move this EventSource to OPEN state...
                if (this.readyState == this.CONNECTING) {
                    this.readyState = this.OPEN;
                    this.dispatchEvent('open', { type: 'open' });
                }

                var buffer = request.getBuffer();

                if (buffer.length > this.bufferSizeLimit) {
                    this.log('buffer.length > this.bufferSizeLimit');
                    this.pollAgain();
                }

                if (this.cursor == 0 && buffer.length > 0){

                    // skip byte order mark \uFEFF character if it starts the stream
                    if (buffer.substring(0,1) == '\uFEFF'){
                        this.cursor = 1;
                    }
                }

                var lastMessageIndex = this.lastMessageIndex(buffer);
                if (lastMessageIndex[0] >= this.cursor){

                    var newcursor = lastMessageIndex[1];
                    var toparse = buffer.substring(this.cursor, newcursor);
                    this.parseStream(toparse);
                    this.cursor = newcursor;
                }

                // if request is finished, reopen the connection
                if (request.isDone()) {
                    this.log('request.isDone(). reopening the connection');
                    this.pollAgain(this.interval);
                }
            }
            else if (this.readyState !== this.CLOSED) {

                this.log('this.readyState !== this.CLOSED');
                this.pollAgain(this.interval);

                //MV: Unsure why an error was previously dispatched
            }
        },

        parseStream: function(chunk) {

            // normalize line separators (\r\n,\r,\n) to \n
            // remove white spaces that may precede \n
            chunk = this.cache + this.normalizeToLF(chunk);

            var events = chunk.split('\n\n');

            var i, j, eventType, datas, line, retry;

            for (i=0; i < (events.length - 1); i++) {

                eventType = 'message';
                datas = [];
                parts = events[i].split('\n');

                for (j=0; j < parts.length; j++) {

                    line = this.trimWhiteSpace(parts[j]);

                    if (line.indexOf('event') == 0) {

                        eventType = line.replace(/event:?\s*/, '');
                    }
                    else if (line.indexOf('retry') == 0) {

                        retry = parseInt(line.replace(/retry:?\s*/, ''));
                        if(!isNaN(retry)) {
                            this.interval = retry;
                        }
                    }
                    else if (line.indexOf('data') == 0) {

                        datas.push(line.replace(/data:?\s*/, ''));
                    }
                    else if (line.indexOf('id:') == 0) {

                        this.lastEventId = line.replace(/id:?\s*/, '');
                    }
                    else if (line.indexOf('id') == 0) { // this resets the id

                        this.lastEventId = null;
                    }
                }

                if (datas.length) {
                    // dispatch a new event
                    var event = new MessageEvent(eventType, datas.join('\n'), window.location.origin, this.lastEventId);
                    this.dispatchEvent(eventType, event);
                }
            }

            this.cache = events[events.length - 1];
        },

        dispatchEvent: function (type, event) {
            var handlers = this['_' + type + 'Handlers'];

            if (handlers) {

                for (var i = 0; i < handlers.length; i++) {
                    handlers[i].call(this, event);
                }
            }

            if (this['on' + type]) {
                this['on' + type].call(this, event);
            }

        },

        addEventListener: function (type, handler) {
            if (!this['_' + type + 'Handlers']) {
                this['_' + type + 'Handlers'] = [];
            }

            this['_' + type + 'Handlers'].push(handler);
        },

        removeEventListener: function (type, handler) {
            var handlers = this['_' + type + 'Handlers'];
            if (!handlers) {
                return;
            }
            for (var i = handlers.length - 1; i >= 0; --i) {
                if (handlers[i] === handler) {
                    handlers.splice(i, 1);
                    break;
                }
            }
        },

        _pollTimer: null,

        _noactivityTimer: null,

        _xhr: null,

        lastEventId: null,

        cache: '',

        cursor: 0,

        onerror: null,

        onmessage: null,

        onopen: null,

        readyState: 0,

        // ===================================================================
        // helpers functions
        // those are attached to prototype to ease reuse and testing...

        urlWithParams: function (baseURL, params) {

            var encodedArgs = [];

            if (params){

                var key, urlarg;
                var urlize = encodeURIComponent;

                for (key in params){
                    if (params.hasOwnProperty(key)) {
                        urlarg = urlize(key)+'='+urlize(params[key]);
                        encodedArgs.push(urlarg);
                    }
                }
            }

            if (encodedArgs.length > 0){

                if (baseURL.indexOf('?') == -1)
                    return baseURL + '?' + encodedArgs.join('&');
                return baseURL + '&' + encodedArgs.join('&');
            }
            return baseURL;
        },

        lastMessageIndex: function(text) {

            var ln2 =text.lastIndexOf('\n\n');
            var lr2 = text.lastIndexOf('\r\r');
            var lrln2 = text.lastIndexOf('\r\n\r\n');

            if (lrln2 > Math.max(ln2, lr2)) {
                return [lrln2, lrln2+4];
            }
            return [Math.max(ln2, lr2), Math.max(ln2, lr2) + 2]
        },

        trimWhiteSpace: function(str) {
            // to remove whitespaces left and right of string

            var reTrim = /^(\s|\u00A0)+|(\s|\u00A0)+$/g;
            return str.replace(reTrim, '');
        },

        normalizeToLF: function(str) {

            // replace \r and \r\n with \n
            return str.replace(/\r\n|\r/g, '\n');
        }

    };

    if (!isOldIE()){

        EventSource.isPolyfill = "XHR";

        // EventSource will send request using XMLHttpRequest
        EventSource.prototype.XHR = function(evs) {

            request = new XMLHttpRequest();
            this._request = request;
            evs._xhr = this;

            // set handlers
            request.onreadystatechange = function(){
                if (request.readyState > 1 && evs.readyState != evs.CLOSED) {
                    if (request.status == 200 || (request.status>=300 && request.status<400)){
                        evs._onxhrdata();
                    }
                    else {
                        request._failed = true;
                        evs.readyState = evs.CLOSED;
                        evs.dispatchEvent('error', {
                            type: 'error',
                            data: "The server responded with "+request.status
                        });
                        evs.close();
                    }
                }
            };

            request.onprogress = function () {
            };

            request.open('GET', evs.urlWithParams(evs.URL, evs.getArgs), true);

            var headers = evs.xhrHeaders; // maybe null
            for (var header in headers) {
                if (headers.hasOwnProperty(header)){
                    request.setRequestHeader(header, headers[header]);
                }
            }
            if (evs.lastEventId) {
                request.setRequestHeader('Last-Event-Id', evs.lastEventId);
            }

            request.send();
        };

        EventSource.prototype.XHR.prototype = {

            useXDomainRequest: false,

            _request: null,

            _failed: false, // true if we have had errors...

            isReady: function() {


                return this._request.readyState >= 2;
            },

            isDone: function() {

                return (this._request.readyState == 4);
            },

            hasError: function() {

                return (this._failed || (this._request.status >= 400));
            },

            getBuffer: function() {

                var rv = '';
                try {
                    rv = this._request.responseText || '';
                }
                catch (e){}
                return rv;
            },

            abort: function() {

                if ( this._request ) {
                    this._request.abort();
                }
            }
        };
    }
    else {

  EventSource.isPolyfill = "IE_8-9";

        // patch EventSource defaultOptions
        var defaults = EventSource.prototype.defaultOptions;
        defaults.xhrHeaders = null; // no headers will be sent
        defaults.getArgs['evs_preamble'] = 2048 + 8;

        // EventSource will send request using Internet Explorer XDomainRequest
        EventSource.prototype.XHR = function(evs) {

            request = new XDomainRequest();
            this._request = request;

            // set handlers
            request.onprogress = function(){
                request._ready = true;
                evs._onxhrdata();
            };

            request.onload = function(){
                this._loaded = true;
                evs._onxhrdata();
            };

            request.onerror = function(){
                this._failed = true;
                evs.readyState = evs.CLOSED;
                evs.dispatchEvent('error', {
                    type: 'error',
                    data: "XDomainRequest error"
                });
            };

            request.ontimeout = function(){
                this._failed = true;
                evs.readyState = evs.CLOSED;
                evs.dispatchEvent('error', {
                    type: 'error',
                    data: "XDomainRequest timed out"
                });
            };

            // XDomainRequest does not allow setting custom headers
            // If EventSource has enabled the use of GET arguments
            // we add parameters to URL so that server can adapt the stream...
            var reqGetArgs = {};
            if (evs.getArgs) {

                // copy evs.getArgs in reqGetArgs
                var defaultArgs = evs.getArgs;
                    for (var key in defaultArgs) {
                        if (defaultArgs.hasOwnProperty(key)){
                            reqGetArgs[key] = defaultArgs[key];
                        }
                    }
                if (evs.lastEventId){
                    reqGetArgs['evs_last_event_id'] = evs.lastEventId;
                }
            }
            // send the request

            request.open('GET', evs.urlWithParams(evs.URL,reqGetArgs));
            request.send();
        };

        EventSource.prototype.XHR.prototype = {

            useXDomainRequest: true,

            _request: null,

            _ready: false, // true when progress events are dispatched

            _loaded: false, // true when request has been loaded

            _failed: false, // true if when request is in error

            isReady: function() {

                return this._request._ready;
            },

            isDone: function() {

                return this._request._loaded;
            },

            hasError: function() {

                return this._request._failed;
            },

            getBuffer: function() {

                var rv = '';
                try {
                    rv = this._request.responseText || '';
                }
                catch (e){}
                return rv;
            },

            abort: function() {

                if ( this._request){
                    this._request.abort();
                }
            }
        };
    }

    function MessageEvent(type, data, origin, lastEventId) {

        this.bubbles = false;
        this.cancelBubble = false;
        this.cancelable = false;
        this.data = data || null;
        this.origin = origin || '';
        this.lastEventId = lastEventId || '';
        this.type = type || 'message';
    }

    function isOldIE () {

        //return true if we are in IE8 or IE9
        return (global.XDomainRequest && (global.XMLHttpRequest && (new global.XMLHttpRequest()).responseType === undefined)) ? true : false;
    }

    global[evsImportName] = EventSource;
    
})((this || self));


/**
 *
 * Project: BeamzerClient
 * License: MIT
 * Author: Ifeora Okechukwu (isocroft@gmail.com) 
 * 
 * Covers: IE8.0+, FF3.5+, Chrm2.0+, Saf3.0+, Opr5.0+
 *
 * This wrapper script makes use of the JS polyfill
 * located at https://github.com/amvtek/EventSource/
 *
 * Polyfill Dependency Author: devel@amvtek.com
 */

/*!
 * Example:
 *
 *         var beam = new BeamzerClient({
 *              source:"http://www.example.com/beamrays",
 *              params:{
 *                  choords:["$x", "$y"],
 *                  id:"id"
 *              },
                options:{loggingEnabled:true, crossdomain:true, interval:4500}
 *         });
 *
 *         beam.start(function onOpen(e){ }, onfunction onError(e){ }, function onMessage(e){ });
 *         beam.on("update", function(e){ });
 *         beam.on("noupdate", function(e){ });
 *         beam.newClient({source:"http://www.example.com/beamrays",params:{},options:{}});
 *         beam.off("update");
 *         beam.stop(function(e){ });
 *         
 */
 
 // @see https://github.com/amvtek/EventSource/blob/master/javascript/src/eventsource.js 

;(function(global, factory, undefined){

  // filling up JS object(s) API where missing
  Array.prototype.indexOf = Array.prototype.indexOf || function(needle){
       var array = this, length = array.length;
       for(var i = 0; i < length; i++){
          if(needle === array[i]){
              return i;
          }
       }
       return -1;
  };

  Object.keys = Object.keys || function(object){
     var property, keys = [];
     for(property in object){
        if((!!object.hasOwnProperty)
             && object.hasOwnProperty(property)){
             keys.push(property);
        }
     }
     return keys;
  }

  // UMD
  if(typeof module != 'undefined' && (!!module.exports)){
       module.exports = factory();
  }else if(typeof define != 'undefined' && (!!define.amd)){
       define("BeamzerClient", factory);
  }else if(global !== undefined && (global.window === global)){
       global.BeamzerClient = factory(global); 
  }

}((this || self), function(win){

      // load the shim so it polyfills as "EventSource" on the global object
      // for browsers that don't natively support "EventSource" constructor
      if(!win.EventSource){ 
           return;
      }  

      var _arr = ([]),

      _obj = ({}),

      _noop = function(){},

      beamzerOrigin = 'https://app.beamzer.co',

      _url_obj = "[object URL]",

      _arr_obj = "[object Array]",

      _func_obj = "[object Function]",
          
      _obj_obj = "[object Object]",

      _oops = [''],

      toString = _obj.toString,

      hasOWnProp = _obj.hasOwnProperty,

     /* doc = win.document, */

      loc = win.location,

      isOldBrowser = !function(w){

          try{
             /*
                try to detect a browser that doesn't 
                properly recognize "functions" because
                it sees them as "objects" 
 
                e.g. fr**kin' stupid IE8!
             */
             var timeout = w.setTimeout.apply(w, _noop);
          }catch(ex){ return true; }

          return false;
      }(win),

      regexFunctionName = /^function(?:[\s]*)(.+(?=\())/i,

      _origin = (loc.origin + '/') || (loc.protocol + '//' +  loc.host + (loc.port || "") + '/'),

      open_or_error = /^(?:on|)?(?:open|error)/i, 

      rgx_url = /^https?\:\/\/(?:([\w]+?)\.){1,2}(?:com?|org|co\.uk|ex|ca|co\.za|net|ng|com\.ng|gov|mil|biz|info|io|me|dev|ng|mobi|name|edu|nti|aero|jobs|museumco\.za)\/?/,

      _clientsObject = null,

      _instance = null,

       _each = function(obj, callback){
            for(var prop in obj){
               if(hasOWnProp.call(obj, prop)){
                    callback(obj[prop], prop, obj);
               }
            }
       },

      _isShim = (isOldBrowser || ('poll' in win.EventSource.prototype) && (typeof(win.EventSource.prototype.poll) === "function")),

      connections = {},

      EventsRegistry = (function registry(){
            
            var eventsMap = {};
            var proxyObserverList = {};

            function addGlobalHandler(object){
              
                var _wrap = function(callable){
                    return function(e, url){
                        if(e.target.readyState === EventSource.CLOSED){
                            if(typeof this.close == "function"){
                                //this.close();
                                callable.apply(null, [e, url]);
                                if(!!win.console){
                                    win.console.log("[BeamzerClient]: Server-Sent Event Stream Closed!");
                                }
                            }
                        }else if(e.target.readyState === EventSource.CONNECTING){
                                if(!!win.console){
                                    win.console.log("[BeamzerClient]: Server-Sent Event Stream Connecting...");
                                }
                                callable.apply(this, [e, url]);
                        }
                    }
                };
               
               // adding events and their handlers from the global map only
                _each(object, function(handler, event){ 
                      var prefix = '', _event;
                      switch(event){
                         case 'open':
                         case 'error':
                         case 'message':
                             prefix = 'on';
                         break;
                      }
                      _event = prefix + event;
                      if(!hasOWnProp.call(eventsMap, _event)){
                          if(typeof handler == "function"){
                             eventsMap[_event] = _wrap(handler);
                          }  
                      } 
                });        
            }

            function removeGlobalHandler(event){
                 // removing events and their handlers from the global map only
                 if(hasOWnProp.call(eventsMap, event)){
                       delete eventsMap[event];
                       return true;
                 } 

                 return false;
            }

            function readyProxyObserver(event, url, noCall){
                 var proxy;
                 if(!hasOWnProp.call(proxyObserverList, url)){
                     proxyObserverList[url] = {
                           events:[],
                           callback:function(e){
                             var _self = this;
                             e = e || {} // hoisting...
                             _each(eventsMap, function(item, key){ 
                                 if(key.indexOf((e.type || event)) > -1){
                                     if((!noCall) && (key.match(open_or_error) || true)){
                                          eventsMap[key].call(_self, e, url);
                                     }     
                                 }
                             });  
                           }
                     };
                 }

                 proxy = proxyObserverList[url]; 

                 if(proxy && proxy.events && typeof proxy.events.push === 'function') {
                    proxy.events.push(event);  
                 }

                 return proxy.callback;
            }

            function getProxy(url){
                if(hasOWnProp.call(proxyObserverList, url)){
                    return proxyObserverList[url];
                }

                return null;
            }

            function getEvents(){
                return eventsMap;
            }

            return {
                getEvents:getEvents,
                getProxy:getProxy,
                readyProxyObserver:readyProxyObserver,
                removeGlobalHandler:removeGlobalHandler,
                addGlobalHandler:addGlobalHandler
            };
 
      }),

      _installEvents = function(object, noCall){
          var evts = EventsRegistry.getEvents(), _evts = Object.keys(evts), _event;
          if(toString.call(object.constructor) !== _func_obj){
              _each(object,  function(connection, url){
                  _each(evts, function(callback, event){
                     if(event.indexOf('on') === 0){
                         _event = event.replace('on', '');
                         if(connection[event] === null)
                            connection[event] = EventsRegistry.readyProxyObserver(_event, url, noCall);
                     }else{
                          if(_evts.indexOf(event) == -1)
                             connection.addEventListener(event, EventsRegistry.readyProxyObserver(event, url, noCall), false);
                     }
                  });   
              });
          }else{
               _each(evts, function(callback, event){
                   if(event.indexOf('on') === 0){
                       _event = event.replace('on', '');
                       if(object[event] === null)
                          object[event] = EventsRegistry.readyProxyObserver(_event, url, noCall);
                   }else{
                       if(evts.indexOf(event) == -1)
                          object.addEventListener(event, EventsRegistry.readyProxyObserver(event, url, noCall), false);
                   }
                });
          }  
      },

      _disconnect = function(object, url){
          var proxy, num_of_connections_closed = 0, urls = [], time = (new Date)*1;
          if(toString.call(object.constructor) !== _func_obj){
              _each(object, function(connection, url){
                   proxy = EventsRegistry.getProxy(url);
                   if(proxy !== null){
                     _each(proxy.events, function(event){
                        urls.push(url);
                        connection.removeEventListener(event, proxy.callback);
                        connection.close();
                        ++num_of_connections_closed;
                     }); 
                   }   
              });
          }else{
              if(url){
                   proxy = EventsRegistry.getProxy(url);
                   if(proxy !== null){
                      urls.push(url);
                      if(proxy.events.indexOf(event) > -1){
                         object.removeEventListener(event, proxy.callback);
                      } 
                      object.close();
                      ++num_of_connections_closed;
                   }
              }
          }

          object = null; // free memory

          return function(callback){
              if(typeof callback == "function"){
                    callback({
                      type:"closed",
                      timestamp:time,
                      urls:urls,
                      closed_connections:num_of_connections_closed
                    });
              }
          }
      },

      _isEmpty = function(obj){
           if(typeof obj !== "object"){
              return false;
           }

           for(var i in obj){
               if(hasOWnProp.call(obj, i)){
                   return false;
               }
           }
           return true;
      },

      _objectToQuery = function(object, _url, _prefix){
          var query = _url.indexOf("?") == -1 ? "?" : "";
          if(!object || _isEmpty(object)){
             return _url;
          }
          _each(object, function(qval, qkey){
              if(toString.call(qval) === _arr_obj) {
                for (var i_qval = 0; i_qval < qval.length; i_qval++){
                    query += (_prefix + win.encodeURIComponent(qkey)) + "=" + win.encodeURIComponent(qval[i_qval]) + "&";
                }
              } else if(typeof qval === 'string') {
                query += (_prefix + win.encodeURIComponent(qkey)) + "=" + win.encodeURIComponent(qval) + "&";
              }
          });
          return _url + (query.length <= 1)? "" : (query.replace(/\&$/, ''));
      },
      
      _objectToForm = function(object, _prefix){
         var form = "";
         if(!object || _isEmpty(object)){
            return _url;
         }
         _each(object, function(qval, qkey){
             if(qkey === 'retry'){
                 qval = String(qval)
             }
             if(toString.call(qval) === _arr_obj 
                || toString.call(qval) === _obj_obj) {
                   if(qkey !== 'target') {
                        form += (_prefix + win.encodeURIComponent(qkey)) + "=" + win.encodeURIComponent(JSON.stringify(qval)) + "&";
                   }else{
                        var sub = _objectToQuery(qval, "", "")
                        form += sub.replace('?', '');
                   }
             } else if(typeof qval === 'string') {
               form += (_prefix + win.encodeURIComponent(qkey)) + "=" + win.encodeURIComponent(qval) + "&";
             }
         });
         return (form.length == 0)? form : (form.replace(/\&$/, ''));
      },

      Clients = function (settings, forceNew){

          if(toString.call(settings) !== _obj_obj){
            settings = {}
          }

          var url = settings.source || '';
          var params = settings.params || null;
          var options = settings.options || null;
          var connection = null;

          if(url === ''){
              throw new Error('Cannot connect to stream: URL missing');
          }

          if(toString.call(url) === _url_obj){
            url = url.toString();
          }

          if(!rgx_url.exec(url)){
              url = _origin + url;
          }

          if(!_isShim){
               url = _objectToQuery(params, url, "");
          }else{
               options.getArgs = params;
          }
        
          if(String(options.headers) == _obj_obj){
               url = _objectToQuery(options.headers, url, ":");
          }
        
          if(options.crossdomain === true){
              options.withCredentials = options.crossdomain;
              delete options.crossdomain;
          }

          //setTimeout(function delayConnection() {

                if(!hasOWnProp.call(connections, url)){
                    connection = new EventSource(url, options);
                }else{
                    connection = connections[url];
                    if(forceNew === true){
                        _temp = _disconnect(connection, url);
                        connection = _temp = null; // free memory
                        connection = new EventSource(url, options);
                        _installEvents(connection, (options === null || !_isEmpty(options)));
                    }
                } 

                // @TODO check if cyclic referencing exists here later...
                connections[url] = connection; 
          //}, 0);

          // enforce new 
          return (this === win)? new Clients(settings, forceNew): this;
      };

      Clients.prototype.disconnect = function(callback){
          var interface = _disconnect(connections);
          connections = {};
          interface(callback);
          return (interface = null); // free memory
      }

      Clients.prototype.on = function(compositeHandlerList){
          EventsRegistry.addGlobalHandler(compositeHandlerList);
          _installEvents(connections);
      }

      Clients.prototype.off = function(event){
           var evt = event || '';
           EventsRegistry.removeGlobalHandler(evt);
      }

      var _makeClients = function(settings, forceNew){
        if(_clientsObject === null){
             _clientsObject = new Clients(settings, forceNew || false);
        }
      };

      function BeamzerClient(settings){

           if(!settings){
              settings = {};
           }
        
           this.url = settings.source || "";

           if(_instance === null){
               // Singleton
               _instance = {
                    constructor:BeamzerClient,
                    start:function(openCallback, errorCallback, msgCallback){
                        _makeClients(settings);
                        _clientsObject.on({'open':openCallback,'error':errorCallback,'message':msgCallback});
                    },
                    on:function(event, callback){
                       if(event.match(open_or_error)){
                           return;
                       }
                       event = event.replace('on', ''); // hoisting
                       if(!!_clientsObject){
                            _clientsObject.on({event:callback});
                       }else{
                           throw new Error("Illegal Invocation: Beamzer connection instance doesn't yet exist. try call `start()` first")
                       }
                    },
                    off:function(event){
                        if(!!_clientsObject){
                            _clientsObject.off(event);
                        }else{
                            throw new Error("Illegal Invocation: Beamzer connection instance doesn't yet exist. try call `start()` first")
                        }
                    },
                    newClient:function(settings){
                         forceNew = (typeof(settings.params) == "object" && !_isEmpty(settings.params));
                        _makeClients(settings, forceNew);
                    },
                    stop:function(callback){
                        if(!!_clientsObject){
                            _clientsObject.disconnect(callback);
                        }else{
                            throw new Error("Illegal Invocation: Beamzer connection instance doesn't yet exist. try call `start()` first")
                        }
                    }
               }
           }   

           return _instance;
      };

      /**
       * MERCURE PROTOCOL - Helpers
       * 
       * These static methods are for use with the mercure protocol
       * https://www.github.com/dunglas/mercure
       * 
       * - Hub Discovery/Authorization
       * 
       * BeamzerClient.serviceDiscoveryAndAuth(['*']).then(function(details){
       *    
       *    var beam = new BeamzerClient({
       *        source:details.hubUrl,
       *        params:{
       *            topic: details.topics.map(function(topic){ return topic['@id']; })
       *        },
       *        options:{loggingEnabled:true, crossdomain:true, interval:4500}
       *    })
       * 
       *    return beam;
       * }).then(function(beam){
       *    document.addEventListener('DOMContentLoaded', function(){
       *        beam.start(
       *            function onOpen(e){
       *            },
       *            function onError(e){
       * 
       *            },
       *            null
       *        );
       *    }, false);
       * 
       *    window.addEventListener('beforeunload', function(e){
       *        beam.stop(function(e){
       *            navigator.sendBeacon('')
       *        })
       *    }, false);
       * });
       * 
       * 
       * 
       * 
       * 
       * 
       * 
       * BeamzerClient.publishToHub({
       *    retry:4000,
       *    topic:'https://app.beamzer.co/example/activity/chat',
       *    data:{
       *        message:"Hello there...",
       *        sent_by:'user_96435799292',
       *        sent_to:'thread_24237291120'
       *    }
       * })
       * 
       */

      BeamzerClient.publicKey = null;

      BeamzerClient.targets = {}; // targets = {'https://www.example.com':['https://app.beamzer.co/example/default', 'https://app.beamzer.co/example/activity/chat']}

      BeamzerClient.serviceDiscoveryAndAuth = function(targets){

        targets = targets || [ _origin ];
        
        var pathname = '/beamzer/discovery/auth';
        var discoveryAuthUrl = _origin + pathname;
                
        return new Promise(function (resolve, reject) {

            var req = ((typeof win.toStaticHTML === 'function') ? new ActiveXObject("Microsoft.XMLHTTP") : new XMLHttpRequest);

            if(typeof req.setRequestHeader === 'function'){
                req.setRequestHeader('Accept', 'application/ld+json');
                //req.setRequestHeader('X-Api-Key', String(BeamzerClient.publicKey));
                req.setRequestHeader('Cache-Control', 'no-transform');
            }

            req.ontimeout = function(e){
                reject(e)
            };

            req.onerror = function(e){
                reject(e);
            };

            req.timeout = 8100;

            req.onreadystatechange = function(e){

                var linkHeader = null;
                var apiKey = null;

                if ((e.type === "readystatechange" && req.readyState === 4)) {
                    if (req.status === 200 || (req.status >= 300 && req.status < 400)){

                        targetDetails = JSON.parse(req.responseText);
                        
                        if(typeof req.getResponseHeader === 'function') {
                            linkHeader = req.getResponseHeader('Link') || null;

                            apiKey = req.getResponseHeader('X-Beamzer-Public-Key') || null;
                        }

                        if(linkHeader === null){
                            linkHeader = '<https://service.beamzer.co/hub>; rel="mercure"';
                        }

                        BeamzerClient.targets = targetDetails;
                        BeamzerClient.publicKey = apiKey;

                        resolve({
                            hubUrl:linkHeader.match(/<([^>]+)>;\s+rel=(?:mercure|"[^"]*mercure[^"]*")/)[1],
                            topics:BeamzerClient.targets[_origin] || []
                        })
                    }
                }
            };
                
            req.open('GET', _objectToQuery(discoveryAuthUrl, {targets:JSON.stringify(targets)}, ""), true);

            req.send(null);  
        });
      };

      BeamzerClient.pingAuthExpiration = function(){

        var expUrl = beamzerOrigin + '/hub/auth/expire';

        return new Promise(function (resolve, reject) {
            var req = new Image();

            req.onload = function(e){
                resolve(true)
            };

            req.onerror = function(e){
                reject(false)
            };

            req.src = _objectToQuery({
                publickey:String(BeamzerClient.publicKey)
            }, expUrl, "")
        });
      };

      BeamzerClient.publishToHub = function(requestData){

        var pathname = '/hub/publish';
        var hubUrl = beamzerOrigin + pathname;

        requestData = requestData || {
            target: [ _origin ],
            data:{title:"Activity Stream", body:"A New Text Stream!"},
            topic:'default', // https://app.beamzer.co/example/default
            type:'broadcast',
            retry:3000,
            id:'cjld2cjxh0000qzrmn831i7rn' // cuid
        };

        if((BeamzerClient.targets[_origin] || []).indexOf(requestData.topic || "") === -1){
            return Promise.reject(new Error('Invalid Entry: topic `'+ requestData.topic +'` supplied is not available for current target'));
        }

        return new Promise(function (resolve, reject) {

            var req = ((typeof win.toStaticHTML === 'function') ? new XDomainRequest : new XMLHttpRequest);
            

            if(typeof req.setRequestHeader === 'function'){
                req.setRequestHeader('Accept', 'application/ld+json')
                req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                req.setRequestHeader('X-Api-Key', String(BeamzerClient.publicKey));
            }else{ // {XDomainRequest} can't set headers as the API is missing unlike {XMLHttpRequest}
                req.headers = {
                    'content-type': 'application/x-www-form-urlencoded',
                    'accept': 'application/ld+json',
                    'origin': _origin.replace(/\/$/, ''),
                    'x-api-key': String(BeamzerClient.publicKey)
                };
            }

            if(hasOWnProp.call(req.prototype, 'withCredentials')) {
                req.withCredentials = true;
            }

            req.onerror = function(e){
                reject(e)
            }

            req.ontimeout = function(e){
                reject(e)
            }

            req.onprogress = function(){}

            if(typeof win.toStaticHTML === 'function') {
                req.open('POST', _objectToQuery(req.headers, hubUrl, ''), true);
            }else{
                req.open('POST', hubUrl, true);
            }

            req.onreadystatechange = function(e){
                if ((e.type === "readystatechange" && req.readyState === 4)) {
                    if (req.status === 200 || req.status === 201){

                        dispatchDetails = JSON.parse(req.responseText);
                        
                        resolve({
                            dispatch:dispatchDetails
                        })
                    }
                }
            };

            setTimeout(function(){
                req.send(
                    _objectToForm(requestData, "")
                );
            }, 0);            
        });
      }

      return BeamzerClient;
}));