App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: this.globalData.cloudEnvId || undefined,
        traceUser: true
      });
    }
  },
  globalData: {
    cloudEnvId: "cloud1-d9gd0nuo3200779e8",
    useCloudRelay: true,
    brokerUrl: "wxs://broker-cn.emqx.io:8084/mqtt",
    telemetryTopic: "HIT/PetData",
    alertTopic: "HIT/PetAlert",
    controlTopic: "HIT/PetControl",
    petName: "小七"
  }
});
