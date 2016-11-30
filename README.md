﻿# BeamzerClient

This This wrapper script makes use of the JS polyfill for Server-Sent Events located at https://github.com/amvtek/EventSource/ and makes it easy to manage several connections to *push notification* sources.

## Usage
 
```html
  <!DOCTYPE html>
  <html lang="en">
     <head>
	      <meta charest="utf-8">
		    <title>BeamzerClient - Example</title>
		  
		    <script type="text/javascript" src="/path/to/beamzer-client.js"></script>
	   </head>
	   <body class="screen">
	      <script type="text/javascript">
		           var beam = new BeamzerClient({
                    source:"http://www.example.com/beamrays",
                    params:{
                        id:"id"
                    },
                    options:{loggingEnabled:true, interval:4500}
               });

               // open a connection with relevant callbacks
               beam.open(function onopenCalback(e){ }, function onerrorCalback(e){ }, function onmessageCalback(e){ });
               // register an event [update]
               beam.on("update", function(e){ });
               // register another event [noupdate]
               beam.on("noupdate", function(e){ });
               // recreate a connection. 
               beam.new_client({source:"http://www.example.com/beamrays",params:{},options:{}});
               // unregister an event [update]
               beam.off("update");
               // close all the connection(s)
               beam.close(function(e){ });
		    </script>
	   </body>
  </html>
```

>It is important to note that whenever.

**AngularJS UseCase Example**

The idea here is to loosely couple communications to beamzer-client in an AngularJS app and

```js
 
  /* 
    
    The idea here is to loosely couple the different controllers to the beamzer-client event stream from the server.
    Instead of having multiple observers for each controller scope listening for incoming streams, we have a single
    mediator object powered by $rootScope for this purpose.

  */

;(function(w, angular){

   var module = angular.module("TheAppServices"); // assumes this module has been defined before

   module.factory("$activityStreamer", [function(){
   
        // assumes that [$values] is another service defined before that contains the stream URL data 

        var ENDPOINT = 'http://www.example.com/streamer.php',

            CLIENT = null, 

            started = false;
 
        return {
           
            start:function(openCallback, errorCallback, msgCallback){
                 
               CLIENT = new w.BeamzerClient({
                  source:ENDPOINT,
                  params:{id:'68AWtlwGTE65hDE34j9Lm'},
                  options:{loggingEnabled:true, interval:4500}
               });  
 
               CLIENT.open(openCallback, errorCallback, msgCallback); 

               started = true;           
            },
            addEvent:function(event, callback){

                CLIENT.on(event, callback);

            },
            removeEvent:function(event){

                CLIENT.off(event);
            },
            newConnection:function(settings){

               CLIENT.new_client(settings);
            },
            end:function(closeCallback){
                
               CLIENT.close(closeCallback);
            },
            isStarted:function(){

                return started;
            }

        }       

   }]);

}(this, this.angular));  


;(function(w, angular){

  var module = angular.module("TheAppServices");

  angular.factory("$sessionStorage", ['$window', function($window){
      var data = null, keys = {};

      function setData(){
         $window.name = angular.toJSON(data);
      }

      function clearData(){
        $window.name = data ? (data = {}) && '' : '';
      }

      function getData(){
        return data || angular.fromJSON($window.name || '{}');
      }

      data = getData();

      return ('sessionStorage' in $window) ? $window.sessionStorage : {
            length:0,
            clear:function(){
              keys = {};
              clearData((this.length = 0));
            },
            getItem:function(key){
              var _data = getData(); 
              return (key in _data)? _data[key] : null;
            },
            setItem:function(key, value){
              var _data = getData();
              _data[key] = angular.toJSON(value);
              setData(keys[String(++this.length)] = key);
            },
            key:function(i){
              var _i = String(i);
              return (_i in keys)? keys[i] : null;
            },
            removeItem:function(key){
              var _data = getData();
              delete _data[key];
              setData(keys[String(--this.length)] = key);
            }
      };

  }]);

}(this, this.angular));


;(function(w, angular){

     var usebuffer = false, 
     app = angular.module("TheApp", ["TheAppServices"]);

     // we assume here that this ficticious app (TheAppServices) has a '#/feeds' route registered prior

     app.run(['$activityStreamer', 
              '$sessionStorage', 
              '$rootScope', 
              '$route', function($activityStreamer, $sessionStorage, $rootScope, $route){

          
          $rootScope.$on('newStreamerRequest', function(event, data){

                  // assuming -- $scope.$emit('newStreamerRequest', {settings:{url:'...',params:{}}}) -- is called

                  $activityStreamer.newConnection(data.settings);

          });

          
          $rootScope.$on('removeStreamerEvent', function(event, data){ 

               // assuming -- $scope.$emit('removeStreamerEvent', {eventName:'update'}) -- is called

               $activityStreamer.removeEvent(data.eventName);

          });

          $rootScope.$on('$destroy', function(event, data){

                    // if we go off from the app itself, kill it... fast!!

                    $activityStreamer.end(function(e){

                          $rootScope.$broadcast('allStreamerExit', e); // notify all listening scopes (perhaps...)

                    });
          });

          $rootScope.$on('$routeChangeStart', function(event, current, previous){

                // if we move away from a 'feeds' route page, buffer all real-time data in sessionStorage!!

                if(previous.url.indexOf('feeds') > -1){ 

                      useBuffer = true;                    

                }    
          });

          $rootScope.$on('$routeChangeSuccess', function(event, current, previous){

                /*$rootScope.title = current.title;*/


                // if we move to a 'feeds' route page, prepare to display real-time data in view

                if(current.url.indexOf('feeds') > -1){ 

                        useBuffer = false;

                        if($activityStreamer.isStarted()){

                              return;
                        }

                        $activityStreamer.start(function(e){

                              $sessionStorage.setItem('ACTIVITY_STREAM_BUFFER', {});

                              $rootScope.$broadcast('newStreamerSuccess', e); // notify all listening scopes
                        },

                        function(e){
               
                            $rootScope.$broadcast('newStreamerFailure', e); // notify all listening scopes

                        },
                        
                        function(e){

                              setTimeout(streams.bind(null, e), 0);

                        });

                        $activityStreamer.addEvent('update', function(e){

                              setTimeout(streams.bind(null, e), 0);

                        });

                        $activityStreamer.addEvent('noupdate', function(e){

                            $rootScope.$broadcast('noNewStreamerMessageRecieved', e); // notify all listening scopes

                        });

                }

                function streams(e){

                          var _buffer = $sessionStorage.getItem('ACTIVITY_STREAM_BUFFER');

                          var _timestamps;

                          if(useBuffer){

                                _buffer[String(new Date*1)] = e;

                                // from here, you can trigger a toast notification on the screen perhaps...

                          }else{

                              if($sessionStorage.length){

                                    _timestamps = Object.keys(_buffers);

                                    // we need to make sure that when all 'buffered' messages are sent
                                    // to all $scopes as and at when they were recieved in buffer mode

                                    _timestamps.sort(function(a, b){
                                        return (b - a);
                                    })

                                    angular.forEach(_timestamps, function(value){

                                        $rootScope.$broadcast('newStreamerMessageRecieved', _buffer[value]);

                                        delete _buffer[value];

                                    });

                              }

                              $rootScope.$broadcast('newStreamerMessageRecieved', e); // notify all listening scopes
                          }

                          $sessionStorage.setItem('ACTIVITY_STREAM_BUFFER', _buffer);
                }

          });         
     });

}(this, this.angular));



/* controller action */

;(function(w, angular){
  
    var app = angular.module("TheApp");

    app.controller(['$scope', function($scope){

          $scope.updatesList = [];

          $scope.$on('newStreamerMessageRecieved', function(event, data){

              var payload = data.data; // the event object from the handler has a 'data' property...

              // assuming [payload] variable is an array...

              angular.forEach(payload, function(item){
                
                   $scope.updateList.push(item); // this updates the view via 'ng-repeat' in the view...

              });
          });

    }]);

}(this, this.angular));
 
```

```php

 # Simple Implementation of event streams on the server - http://www.example.com/streamer.php

 sleep(5); // simulate real prod server activity e.g. database read operation 

 $data = array('status' => 'OK');
 $payload = "event: update \n";
 $payload .= "id: 5RWF637yh9983az021mn \n";
 $payload .= "data: " . json_encode($data) . " \n\n"; // the last line must end with 2 line feed characters

 header('Content-Type: text/event-stream');

 echo $payload;

 exit;

```

## Support

Available on all major browsers including IE7 - If you discover any bugs, please log an issue for it and i'll surely get look into it. 

## Credits

.