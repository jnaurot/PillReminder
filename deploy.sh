adb kill-server && adb start-server
cd android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
