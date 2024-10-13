/**
 * BETA VERSION - TESTING PHASE
 * 
 * This is **Nero 2.0**, a Facebook bot developed by **Jay Patrick Cano** using a modified 
 * version of **fca-unofficial** with fixes from **John Paul Caigas**. This script is in 
 * the **beta testing phase**, and users may encounter errors during use.
 * 
 * Key Points:
 * - **Potential Bugs**: This version may still have undiscovered bugs and may not behave 
 *   as expected.
 * - **Not Production Ready**: It is not optimized for stability or performance and is 
 *   intended for testing only.
 * - **Event Handling**: Event listeners and command handling may require further testing 
 *   for complex scenarios.
 * 
 * Please report any issues or feedback as development continues. Use this script at your 
 * own risk.
 */

const path = require('path');
const fs = require('fs').promises;
const fsWatch = require('fs');
const chalk = require('chalk');
const { authenticateUsers, displayUserInformation } = require('./src/auth/core');
const { loadModules } = require('./src/utils/loader');
const { displayAsciiInfo } = require('./src/utils/ascii_info');
const nero = require('./src/commands/nero.js');
require('./server.js');
process.noDeprecation = true;

const appstateFolderPath = path.join(__dirname, 'src', 'data', 'secrets');

const mutedUsersReminded = new Set();
const mutedUsers = new Map();
const userCommandHistory = new Map();
const MUTE_DURATION = 10 * 60 * 1000;
const COMMAND_LIMIT = 4;
const TIME_LIMIT = 5 * 60 * 1000;

function clearTerminal() {
  if (process.platform === 'win32') {
    process.stdout.write('\x1B[2J\x1B[0f');
  } else {
    process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
  }
}

function handleError(error) {
  console.error(chalk.red('⚠️ Error:'), error);
}

function watchJsonFiles(filePath, callback) {
  fsWatch.watch(filePath, { encoding: 'utf8' }, (eventType, filename) => {
    if (eventType === 'change') {
      callback(filename);
    }
  });
}

(async () => {
  try {
    clearTerminal();
    const asciiInfo = await displayAsciiInfo();
    console.log(asciiInfo);
  } catch (error) {
    handleError('Error displaying ASCII info:', error);
  }

  let exceptionList, settings;

  try {
    const exceptionListFilePath = path.join(__dirname, 'src', 'config', 'restricted_access.json');
    exceptionList = JSON.parse(await fs.readFile(exceptionListFilePath, 'utf8'));
  } catch (error) {
    handleError('Error reading exception list:', error);
    exceptionList = { bots: [], users: [], threads: [] };
  }

  const bots = exceptionList.bots || [];
  const users = exceptionList.users || [];
  const threads = exceptionList.threads || [];

  try {
    const settingsFilePath = path.join(__dirname, 'src', 'config', 'settings.json');
    settings = JSON.parse(await fs.readFile(settingsFilePath, 'utf8'));
    watchJsonFiles(settingsFilePath, async () => {
      try {
        settings = JSON.parse(await fs.readFile(settingsFilePath, 'utf8'));
        console.log(chalk.green(`Settings updated: ${JSON.stringify(settings)}`));
      } catch (error) {
        handleError('Error reading updated settings:', error);
      }
    });
  } catch (error) {
    handleError('Error reading settings:', error);
    settings = [{}];
  }

  const loginOptions = {
    listenEvents: settings.core.listenEvents,
    selfListen: settings.core.selfListen,
    autoMarkRead: settings.core.autoMarkRead,
    autoMarkDelivery: settings.core.autoMarkDelivery,
    forceLogin: settings.core.forceLogin,
  };

  const cmdFolder = path.join(__dirname, 'src', 'commands');
  const eventFolder = path.join(__dirname, 'src', 'events');

  let modules, errors;
  try {
    ({ modules, errors } = await loadModules({
      [cmdFolder]: 'Commands',
      [eventFolder]: 'Events'
    }));
    if (errors.length > 0) {
      console.log(chalk.yellow('\n⚠️ Some modules failed to load. Check the errors above for details.'));
    }
  } catch (error) {
    handleError('Error loading modules:', error);
    modules = { Commands: {}, Events: {} };
    errors = [];
  }

  const commandFiles = modules.Commands || {};
  const eventHandlers = modules.Events || {};
  const userInformation = [];

  let authenticatedUsers;
  try {
    authenticatedUsers = await authenticateUsers(appstateFolderPath, loginOptions);
  } catch (error) {
    handleError('Error authenticating users:', error);
    authenticatedUsers = [];
  }

  for (const user of authenticatedUsers) {
    if (user) {
      const { api, userName, appState } = user;
      if (userName) {
        userInformation.push({ userName, appState });
      }

      if (api && typeof api.listenMqtt === 'function') {
        api.listenMqtt(async (err, event) => {
          if (err) {
            handleError('Error in listenMqtt:', err);
            return;
          }

          try {
            if (
              (bots.includes(event.senderID) ||
                users.includes(event.senderID) ||
                threads.includes(event.threadID)) &&
              (users.length > 0 || threads.length > 0)
            ) {
              return;
            }

            const userId = event.senderID;
            const userMuteInfo = mutedUsers.get(userId);

            if (userMuteInfo) {
              const { timestamp } = userMuteInfo;

              if (Date.now() - timestamp >= MUTE_DURATION) {
                mutedUsers.delete(userId);
                mutedUsersReminded.delete(userId);
                console.log(`User ${userId} has been unmuted.`);
              } else {
                if (!mutedUsersReminded.has(userId)) {
                  try {
                    api.getUserInfo(userId, async (err, ret) => {
                      if (err) {
                        handleError('Error getting user info:', err);
                        return;
                      }
                      if (ret && ret[userId] && ret[userId].name) {
                        const userName = ret[userId].name;
                        api.sendMessage(
                          `Hello ${userName}, you are currently muted. Please patiently wait for approximately ${
                            (MUTE_DURATION - (Date.now() - timestamp)) / 1000
                          } seconds to regain access.`,
                          event.threadID,
                          event.messageID
                        );
                        mutedUsersReminded.add(userId);
                      }
                    });
                  } catch (error) {
                    handleError('Error getting user info:', error);
                  }
                }
                return;
              }
            }

            for (const eventHandler of Object.values(eventHandlers)) {
              if (!userMuteInfo) {
                try {
                  await eventHandler(api, event);
                } catch (error) {
                  handleError(`Error executing event handler for event type ${event.type}:`, error);
                }
              }
            }

            if (event.type === 'message' || event.type === 'message_reply') {
              try {
                const configFilePath = path.join(__dirname, 'src', 'config', 'roles.json');
                const config = JSON.parse(await fs.readFile(configFilePath, 'utf8'));
                const prefix = settings.nero.prefix;

                function isAuthorizedUser(userId, config) {
                  const vipList = config.vips || [];
                  const adminList = config.admins || [];
                  return vipList.includes(userId) || adminList.includes(userId);
                }

                let input = event.body.toLowerCase().trim();
               //  console.log(`Received message: ${input}`);

                if (!input.startsWith(prefix) && prefix !== false) {
                  return;
                }

                if (prefix !== false) {
                  input = input.substring(prefix.length).trim();
                }

               // console.log(`Processing command: ${input}`);

                const matchingCommand = Object.keys(commandFiles).find((commandName) => {
                  const commandPattern = new RegExp(`^${commandName}(\\s+.*|$)`);
                  return commandPattern.test(input);
                });

                if (matchingCommand) {
                 // console.log(`Matched command: ${matchingCommand}`);
                  const userId = event.senderID;
                  const commandHistory = userCommandHistory.get(userId) || [];
                  const now = Date.now();
                  const recentCommands = commandHistory.filter(
                    (timestamp) => now - timestamp <= TIME_LIMIT
                  );

                  recentCommands.push(now);
                  userCommandHistory.set(userId, recentCommands);
                  const isNotAuthorized = !isAuthorizedUser(userId, config);

                  if (recentCommands.length > COMMAND_LIMIT && isNotAuthorized) {
                    if (!mutedUsers.has(userId)) {
                      mutedUsers.set(userId, {
                        timestamp: now,
                        commandCount: recentCommands.length,
                      });
                      api.sendMessage(
                        `Ohh no, you're going too fast. You have been muted for ${
                          MUTE_DURATION / 1000
                        } seconds for excessive command usage.`,
                        event.threadID,
                        event.messageID
                      );
                      console.log(`User ${userId} muted for excessive command usage`);
                    }
                  } else {
                    api.sendTypingIndicator(event.threadID);
                    const cmd = commandFiles[matchingCommand];
                    if (cmd) {
                    //  console.log(`Executing command: ${matchingCommand}`);
                      if (typeof cmd === 'function') {
                        try {
                          await cmd(event, api);
                        } catch (error) {
                          handleError(`Error executing command ${matchingCommand}:`, error);
                          api.sendMessage(`An error occurred while executing the command: ${error.message}`, event.threadID);
                        }
                      } else {
                        console.error(`Invalid command structure for ${matchingCommand}`);
                      }
                    }
                  }
                } else {
                //  console.log(`No matching command found for: ${input}`);
                  const isPrivateThread = event.threadID == event.senderID;
                  const isGroupChat = !isPrivateThread;
                  const containsQuestion = /(\b(what|how|did|where|who)\b|@el cano|@nexus|@nero)/i.test(input);

                  if (!mutedUsers.has(event.senderID)) {
                    if (isPrivateThread) {
                      api.sendTypingIndicator(event.threadID);
                      try {
                        await nero(event, api);
                      } catch (error) {
                        handleError('Error executing Nero in private thread:', error);
                      }
                    //  console.log(`Executing Nero in private thread`);
                    } else if (isGroupChat && containsQuestion) {
                      api.sendTypingIndicator(event.threadID);
                      try {
                        await nero(event, api);
                      } catch (error) {
                        handleError('Error executing Nero in group chat:', error);
                      }
                    //  console.log(`Executing Nero in group chat with question`);
                    }
                  }
                }
              } catch (error) {
                handleError('Error handling the command:', error);
              }
            }
          } catch (error) {
            handleError('Error processing event:', error);
          }
        });
      }
    }
  }

  const exceptionListFilePath = path.join(__dirname, 'src', 'config', 'restricted_access.json');
  watchJsonFiles(exceptionListFilePath, async () => {
    try {
      exceptionList = JSON.parse(await fs.readFile(exceptionListFilePath, 'utf8'));
      console.log(chalk.green(`Exception list updated: ${JSON.stringify(exceptionList)}`));
    } catch (error) {
      handleError('Error reading updated exception list:', error);
    }
  });

  const rolesConfigFilePath = path.join(__dirname, 'src', 'config', 'roles.json');
  watchJsonFiles(rolesConfigFilePath, async () => {
    try {
      const config = JSON.parse(await fs.readFile(rolesConfigFilePath, 'utf8'));
      console.log(chalk.green(`Roles config updated: ${JSON.stringify(config)}`));
    } catch (error) {
      handleError('Error reading updated roles config:', error);
    }
  });

  displayUserInformation(userInformation);
})().catch(error => {
  handleError('Unhandled error in main application:', error);
});