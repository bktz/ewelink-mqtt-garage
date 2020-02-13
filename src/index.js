const eWeLink = require('ewelink-api');
const mqtt = require('mqtt')
const config = require('./config/config.js')
const topicPrefix = config.topicPrefix;
const log = require('simple-node-logger').createSimpleLogger();

var toggling = false;
var garageState;


(async () => {
    try {
        var connection = new eWeLink({
            "region" : config.region,
            "email" : config.email,
            "password" : config.password,
        });
        await connection.getCredentials();

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

        const client  = mqtt.connect(config.mqtt)


        async function toggle() {
            toggling = true;
            log.info("---START TOGGLE---");
            var startStatus = await connection.getDevicePowerState(config.deviceid);
            var startState = startStatus.state;
            var toggled = false;

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

            
            while(toggled === false) {
                await connection.setDevicePowerState(config.deviceid, endState);
                // It will not swap to closed instantly, need to wait for the garage to close.
                // Wait 15s to see if the garage closed otherwise loop.
                if(startState === 'on') {
                    log.info("waiting 15s to see if garage closed...");
                    await new Promise(r => setTimeout(r, 15000));
                }

                currentStatus = await connection.getDevicePowerState(config.deviceid);
                if(currentStatus.state === endState) {
                    toggled = true;
                    if(startState === 'on') {
                        garageState = 'Closed';
                    }
                    if(startState === 'off') {
                        garageState = 'Open';
                    }
                }
            }

            var topic = topicPrefix + '/garage/STATUS';
            client.publish(topic, garageState, {retain: true});
            log.info("MQTT MESSAGE SENT - ", "Topic: ", topic, " Message: ", garageState);

            log.info("---END TOGGLE---");
            toggling = false;
        }

        async function publishStatus() {
            var status = await connection.getDevicePowerState(config.deviceid);
            var topic = topicPrefix + '/garage/STATUS';

            if(status.state === 'off') {
                garageState = 'Closed';
            } else if(status.state === 'on') {
                garageState = 'Open';
            }
            
            // only send message if toggling is false
            if(toggling == false) {
                client.publish(topic, garageState, {retain: true});
                log.info("MQTT MESSAGE SENT - ", "Topic: ", topic, " Message: ", garageState);
            }
        }

        client.on('close', () => {
            log.info('MQTT DEAD');
            process.exit();
        })

        client.on('error', (error) => {
            log.error(error);
        })

        client.on('connect', () => {
            var topic = topicPrefix + '/garage/CMD';
            client.subscribe(topic);
            log.info("MQTT Connected on topic: ", topic)
        })

        client.on('message', async(topic, message) => {
            log.info("MQTT MESSAGE RECEIVED - ", "Topic: ", topic, " Message: ", message.toString());
            if(toggling == false) {
                if(message.toString() === "Open") {
                    if(garageState == "Open") {
                        log.info("Garage already Open...ignoring command.");
                    } else{
                        log.info("Running Toggle");
                        await toggle();
                    }
                } else if(message.toString() === "Closed") {
                    if(garageState == "Closed"){
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
        })

        await connection.openWebSocket(async data => {
            // data is the message from eWeLink
            if(data !== "pong") {
                log.info("Websocket: ", data);
            }
        
            //Publish Garage Status
            if(data.userAgent === "device") {
                await publishStatus();
            }

        });

        await publishStatus();

    } catch(e) {
        log.error(e);
    };
})();