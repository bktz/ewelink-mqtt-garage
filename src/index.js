const eWeLink = require('ewelink-api');
const mqtt = require('mqtt');
const config = require('./config/config.js');
const topicPrefix = config.topicPrefix;
const log = require('simple-node-logger').createSimpleLogger();

const topic = topicPrefix + '/garage/STATUS';

var toggling = false;
var garageState;

(async () => {
    var connection = new eWeLink({
        "region" : config.region,
        "email" : config.email,
        "password" : config.password,
    });

    // // Get devices and put them into a map keyed by the deviceid
    // const detailedDevices = await connection.getDevices();
    // const devices = detailedDevices.reduce(function(map, device) {
    //     map[device.deviceid] = {
    //         "online": device.online,
    //         "switch": device.params.switch,
    //     };
    //     return map;
    // }, {});
    // log.info("Devices: ", devices);

    const client  = mqtt.connect(config.mqtt);

    async function toggle() {
        toggling = true;
        log.info("---START TOGGLE---");
        let startStatus = await connection.getDevicePowerState(config.deviceid);
        log.info("start state: ", startStatus.state);
        let startState = startStatus.state;
        let toggled = false;
        let endState;

        if(startState === 'on') {
            garageState = 'Closing';
            endState = 'off';
            client.publish(topic, garageState, {retain: true});
            log.info("MQTT MESSAGE SENT - ", "Topic: ", topic, " Message: ", garageState);
        }
        if(startState === 'off') {
            garageState = 'Opening';
            endState = 'on';
            client.publish(topic, garageState, {retain: true});
            log.info("MQTT MESSAGE SENT - ", "Topic: ", topic, " Message: ", garageState);
        }


        let currentStatus;
        while (toggled === false) {
            await connection.setDevicePowerState(config.deviceid, endState);
            // It will not swap to closed instantly, need to wait for the garage to close.
            // Wait 15s to see if the garage closed otherwise loop.
            if (startState === 'on') {
                log.info("waiting 15s to see if garage closed...");
                await new Promise(r => setTimeout(r, 15000));
            }

            currentStatus = await connection.getDevicePowerState(config.deviceid);
            if (currentStatus.state === endState) {
                toggled = true;
                if (startState === 'on') {
                    garageState = 'Closed';
                }
                if (startState === 'off') {
                    garageState = 'Open';
                }
            }
        }


        client.publish(topic, garageState, {retain: true});
        log.info("MQTT MESSAGE SENT - ", "Topic: ", topic, " Message: ", garageState);

        log.info("---END TOGGLE---");
        toggling = false;
    }

    async function publishStatus() {
        let status = await connection.getDevicePowerState(config.deviceid);
        log.info("Device power status: ", status);
        let topic = topicPrefix + '/garage/STATUS';

        if(status.state === 'off') {
            garageState = 'Closed';
        } else if(status.state === 'on') {
            garageState = 'Open';
        }

        // only send message if toggling is false
        if(toggling === false) {
            client.publish(topic, garageState, {retain: true});
            log.info("MQTT MESSAGE SENT - ", "Topic: ", topic, " Message: ", garageState);
        }
    }

    client.on('close', () => {
        log.info('MQTT DEAD');
        process.exit();
    });

    client.on('error', (error) => {
        log.error(error);
    });

    client.on('connect', () => {
        let topic = topicPrefix + '/garage/CMD';
        client.subscribe(topic);
        log.info("MQTT Connected on topic: ", topic)
    });

    client.on('message', async(topic, message) => {
        log.info("MQTT MESSAGE RECEIVED - ", "Topic: ", topic, " Message: ", message.toString());
        if(toggling === false) {
            if(message.toString() === "Open") {
                if(garageState === "Open") {
                    log.info("Garage already Open...ignoring command.");
                } else{
                    log.info("Running Toggle");
                    await toggle();
                }
            } else if(message.toString() === "Closed") {
                if(garageState === "Closed"){
                    log.info("Garage already Closed...ignoring command.");
                } else {
                    log.info("Running Toggle");
                    await toggle();
                }
            } else if(message.toString() === "Status") {
                await publishStatus();
            } else {
                log.error("Unknown Command!");
            }
        } else {
            log.info("Toggle in progress...ignoring command.")
        }
    });

    async function websocket() {

        await connection.getCredentials()
            .catch(async event => {
                log.error("Failed to get eWeLink credentials");
                log.info('Sleep for 30s');
                await new Promise(resolve => setTimeout(resolve, 30000));
                log.info('Restarting websocket connection');
                await websocket();
            });

        let wsp = await connection.openWebSocket(async data => {
            // data is the message from eWeLink
            if(data !== "pong") {
                log.info("Websocket: ", data);
            }
            //Publish Garage Status
            if(data.userAgent === "device") {
                await publishStatus();
            }
        })
            .catch(async event => {
                log.error("Websocket connection failure");
                log.info('Sleep for 30s');
                await new Promise(resolve => setTimeout(resolve, 30000));
                log.info('Restarting websocket connection');
                await websocket();
            });

        wsp.onClose.addListener(
            async event => {
                log.error('Websocket connection closed - ', event.reason);
                log.info('Sleep for 30s');
                await new Promise(resolve => setTimeout(resolve, 30000));
                log.info('Restarting websocket connection');
                await websocket();
            }
        );

        log.info('Websocket connected');
        await publishStatus().catch((e) => {
                log.error("Unable to publish status to MQTT - ", e)
            });
    }

    await websocket();

})()
    .catch((e) => {
        log.error("Uncaught exception", e)
    });