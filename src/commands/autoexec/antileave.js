const fs = require('fs').promises;
const path = require('path');

async function autoexec(api, event) {
  const settingsPath = path.join(
    __dirname, '..', '..', 'config', 'settings.json'
  );

  try {
    const settingsData = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(settingsData);

    if (settings && settings.nero && settings.nero.antiLeave === true) {
      if (event.logMessageType === 'log:unsubscribe') {
        const userId = event.logMessageData.leftParticipantFbId;

        try {
          const threadInfo = await new Promise((resolve, reject) => {
            api.getThreadInfo(event.threadID, (err, info) => {
              if (err) reject(err);
              else resolve(info);
            });
          });

          const userInfo = await new Promise((resolve, reject) => {
            api.getUserInfo(parseInt(userId), (err, data) => {
              if (err) reject(err);
              else resolve(data);
            });
          });

          const user = userInfo[userId];
          if (user) {
            setTimeout(async () => {
              try {
                await new Promise((resolve, reject) => {
                  api.addUserToGroup(
                    parseInt(userId),
                    event.threadID,
                    (err) => {
                      if (err) reject(err);
                      else resolve();
                    }
                  );
                });
              } catch (error) {
                // console.error('Error adding user back to group:', error);
              }
            }, 5000);
          }
        } catch (error) {
          // console.error('Error getting thread or user info:', error);
        }
      }
    }
  } catch (error) {
    // console.error('Error reading settings:', error);
  }
}

module.exports = autoexec;
