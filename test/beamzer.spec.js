'use strict'

/**
 * Unit Testing <BeamzerClient>
 * Karma + Jasmine
 * github.com/isocroft/beamzer-client
 */

describe('BeamzerClient Tests', function () {
  // Created Instance
  var BeamzerClient = require('../dist/beamzer-client.min.js')
  var instance = new BeamzerClient({
    source: 'https://app.beamzer.co/hub',
    params: {
      'topic': [
        'https://app.beamzer.co/example/default',
        'https://app.beamzer.co/example/activity/chat'
      ]
    },
    options: { loggingEnabled: false, crossdomain: true }
  })

  it('should have a function (methods) defined', function () {
    /* eslint-disable no-unused-expressions */
    // expect(instance.url).toBe('https://app.beamzer.co/hub')
    expect((typeof instance.start === 'function')).toBe(true)
    expect((typeof instance.stop === 'function')).toBe(true)
    expect((typeof instance.on === 'function')).toBe(true)
    expect((typeof instance.off === 'function')).toBe(true)
    expect((typeof BeamzerClient.publishToHub === 'function')).toBe(true)
    expect((typeof BeamzerClient.serviceDiscoveryAndAuth === 'function')).toBe(true)
    expect((typeof BeamzerClient.pingAuthExpiration === 'function')).toBe(true)
    expect(BeamzerClient.publicKey).toBe(null)
    /* eslint-enable no-unused-expressions */
  })

  it('should throw an error if the `stop()` method is called out of order', function () {
    expect(function () {
      instance.stop()
    }).toThrow(
      new Error(
        "Illegal Invocation: Beamzer connection instance doesn't yet exist. try call `start()` first"
      )
    )
  })
})
