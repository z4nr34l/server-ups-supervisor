/*
 * Copyright (c) 2022.
 * Author: Mateusz "Z4NR34L" Janota
 * Author URI: https://www.zanreal.pl/
 * Author email: software@zanreal.pl
 */

const hosts = require('./hosts.json')
const adapter = require('ever-ups-adapter')
const {NodeSSH} = require('node-ssh')
const ssh = new NodeSSH()

/**
 * SNMP values mapping
 * @type {{"1": string, "2": string, "3": string, "4": string, "5": string, "6": string, "7": string}}
 */
const outputSourceMapping = {
  1: "Other",
  2: "None",
  3: "Normal",
  4: "Bypass",
  5: "Battery",
  6: "Booster",
  7: "Reducer"
}

let oldState = undefined;

if (!hosts) {
  console.error("Please create hosts.json file and provide at least one host data in it.")
}

/**
 * Emergency power-off method definition
 */
function emergencyPowerOff() {
  hosts.every(host => {
    console.log(`Powering-off host: ${host.name} (${host.ip_address})`)
    let sshConfig = {}
    if (host.private_key) {
      sshConfig = {
        host: host.ip_address,
        username: host.username,
        privateKey: host.private_key
      }
    } else {
      sshConfig = {
        host: host.ip_address,
        username: host.username,
        password: host.password,
        tryKeyboard: true
      }
    }
    ssh.connect(sshConfig)
      .then(() => {
        ssh.exec('/sbin/shutdown.sh && /sbin/poweroff', [], {
          onStdout(chunk) {
            console.log(chunk.toString('utf8'))
          },
          onStderr(chunk) {
            console.log(chunk.toString('utf8'))
          },
        }).then(() => {
          console.warn(`Host ${host.name} (${host.ip_address}) going down.`)
        })
      })
  })
}

/**
 * Main script method definition
 * @returns {Promise<void>}
 * @constructor
 */
async function Main() {
  let timeoutHandle = undefined
  const session = adapter.createSession({
    address: "10.0.0.222"
  }, {
    verbose: true
  })

  setInterval(async () => {
    await session.getAllData().then(
      data => {
        const currentState = data.output_source.value

        if(oldState) {
          if(currentState !== oldState) {
            console.warn(`Power state changed! (${outputSourceMapping[currentState]})`)

            if(oldState === 3 && currentState === 5) {
              console.warn("WARNING! Hosts will be powered off in 30 seconds")
              timeoutHandle = setTimeout(()=> {
                emergencyPowerOff()
              }, 30000)
            }
            if(oldState === 5 && currentState === 3) {
              clearTimeout(timeoutHandle)
              console.warn("Hosts poweroff was canceled due to power recovery")
            }

            oldState = currentState;
          }
        } else {
          oldState = currentState;
        }
      }
    ).catch(
      error => console.error(error)
    )
  }, 160 )
}

/**
 * Main method execution call
 */
Main()
