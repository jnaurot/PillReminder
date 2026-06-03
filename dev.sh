echo "start AndroidStudio"
echo "plug in onePlus"

cd /home/james/Projects/PillReminder
adb reverse tcp:8081 tcp:8081
npm run android
npm run start:dev
