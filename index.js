/*
 * Copyright (c) 2022.
 * Author: Mateusz "Z4NR34L" Janota
 * Author URI: https://www.zanreal.pl/
 * Author email: software@zanreal.pl
 */
require('dotenv').config()

const hosts = require('./hosts.json')
const adapter = require('ever-ups-adapter')
const { NodeSSH } = require('node-ssh')
const { MessageEmbed, WebhookClient } = require("discord.js");
const ssh = new NodeSSH()
const webhookClient = new WebhookClient({ url: process.env.DISCORD_WEBHOOK_URL });

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

const messageTypeColorMapping = {
  "info": "#0284c7",
  "success": "#65a30d",
  "warning": "#ea580c",
  "error": "#dc2626"
}

let oldState = undefined
let messageId = undefined
let initMessageId = undefined
let fistStatusMessageSending = false
let pendingActions = false

if (!hosts) {
  console.error("Please create hosts.json file and provide at least one host data in it.")
}

const preInitMessage = new MessageEmbed()
  .setColor(messageTypeColorMapping['info'])
  .setTitle('UPS Supervisor')
  .setDescription('Initializing UPS Supervisor')
  .setTimestamp()
  .setFooter({ text: 'by Z4NR34L', iconURL: 'https://www.zanreal.pl/avatar.png' });

const postInitMessage = new MessageEmbed()
  .setColor(messageTypeColorMapping['success'])
  .setTitle('UPS Supervisor')
  .setDescription('UPS Supervisor initialized and armed')
  .addFields(
    { name: 'Hosts', value: `${hosts.length}`, inline: true },
    { name: 'UPS IP', value: `${process.env.UPS_IP}`, inline: true }
  )
  .setTimestamp()
  .setFooter({ text: 'by Z4NR34L', iconURL: 'https://www.zanreal.pl/avatar.png' });

function sendWebhookHostPoweroffMessage(host) {
  const hostPoweroffMessage = new MessageEmbed()
    .setColor(messageTypeColorMapping['error'])
    .setTitle('UPS Supervisor')
    .setDescription('Powering off host')
    .addFields(
      { name: 'Host', value: host, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: 'by Z4NR34L', iconURL: 'https://www.zanreal.pl/avatar.png' });

  webhookClient.send({
    username: 'UPS Supervisor',
    avatarURL: 'https://www.zanreal.pl/avatar.png',
    embeds: [hostPoweroffMessage]
  })
}

async function sendWebhookStateChangeMessage(oldState, currentState, batteryPercentage, type, customMessage) {

  let embed = undefined

  if(customMessage) {
    embed = new MessageEmbed()
      .setColor(messageTypeColorMapping[type])
      .setTitle('UPS Supervisor')
      .setDescription('Detected UPS state change.')
      .addFields(
        customMessage,
        { name: 'Previous state', value: `${outputSourceMapping[oldState]}`, inline: true },
        { name: 'Current state', value: `${outputSourceMapping[currentState]}`, inline: true },
        { name: 'Battery %', value: `${batteryPercentage}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'by Z4NR34L', iconURL: 'https://www.zanreal.pl/avatar.png' });
  } else {
    embed = new MessageEmbed()
      .setColor(messageTypeColorMapping[type])
      .setTitle('UPS Supervisor')
      .setDescription('Detected UPS state change.')
      .addFields(
        { name: 'Previous state', value: `${outputSourceMapping[oldState]}`, inline: true },
        { name: 'Current state', value: `${outputSourceMapping[currentState]}`, inline: true },
        { name: 'Battery %', value: `${batteryPercentage}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'by Z4NR34L', iconURL: 'https://www.zanreal.pl/avatar.png' });
  }

  if(!messageId) {
    await webhookClient.send({
      username: 'UPS Supervisor',
      avatarURL: 'https://www.zanreal.pl/avatar.png',
      embeds: [embed]
    }).then(message => messageId = message.id)
  } else {
    await webhookClient.editMessage(messageId, {
      username: 'UPS Supervisor',
      avatarURL: 'https://www.zanreal.pl/avatar.png',
      embeds: [embed]
    })
  }

}

/**
 * Emergency power-off method definition
 */
function emergencyPowerOff() {
  hosts.every(host => {
    console.log(`Powering-off host: ${host.name} (${host.ip_address})`)
    sendWebhookHostPoweroffMessage(host.ip_address)
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

  await webhookClient.send({
    username: 'UPS Supervisor',
    avatarURL: 'https://www.zanreal.pl/avatar.png',
    embeds: [preInitMessage]
  }).then(message => initMessageId = message.id)

  let timeoutHandle = undefined
  const session = adapter.createSession({
    address: '10.5.0.254',
    community: process.env.UPS_COMMUNITY
  }, {
    verbose: true
  })

  setInterval(async () => {
    await session.getAllData().then(
      data => {
        const currentState = data.output_source.value

        if(oldState) {
          if(oldState === 3 && !messageId && !fistStatusMessageSending) {
            fistStatusMessageSending = true
            sendWebhookStateChangeMessage(oldState, currentState, data.estimated_battery_percentage.value, "success", undefined)
          }
          if(currentState !== oldState) {
            console.warn(`Power state changed! (${outputSourceMapping[currentState]})`)

            if(oldState === 3 && currentState === 5) {
              sendWebhookStateChangeMessage(oldState, currentState, data.estimated_battery_percentage.value, "warning", { name: '***WARNING***', value: 'VMs and hosts will be shut down in 30 seconds!' })
              console.warn("WARNING! Hosts will be powered off in 30 seconds")
              pendingActions = true
              timeoutHandle = setTimeout(()=> {
                sendWebhookStateChangeMessage(oldState, currentState, data.estimated_battery_percentage.value, "error", { name: '***WARNING***', value: 'VMs and hosts are going to shut down!' })
                emergencyPowerOff()
              }, process.env.FAILSAFE_DELAY || 180000)
            }
            if(oldState === 5 && currentState === 3) {
              clearTimeout(timeoutHandle)
              pendingActions = false
              sendWebhookStateChangeMessage(oldState, currentState, data.estimated_battery_percentage.value, "success", undefined)
              messageId = undefined
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

  if(initMessageId) {
    await webhookClient.editMessage(initMessageId, {
      username: 'UPS Supervisor',
      avatarURL: 'https://www.zanreal.pl/avatar.png',
      embeds: [postInitMessage]
    })
  }
}

/**
 * Main method execution call
 */
Main()
