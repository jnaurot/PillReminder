echo "start AndroidStudio"
echo "plug in onePlus"

cd /home/james/Projects/PillReminder
adb reverse tcp:8018 tcp:8081
npx expo start
