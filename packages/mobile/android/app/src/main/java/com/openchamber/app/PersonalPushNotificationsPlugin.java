package com.openchamber.app;

import android.Manifest;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
    name = "PushNotifications",
    permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "receive")
)
public class PersonalPushNotificationsPlugin extends PushNotificationsPlugin {
    @Override
    @PluginMethod
    public void register(PluginCall call) {
        call.unavailable("Push notifications are unavailable in this personal build.");
    }

    @Override
    @PluginMethod
    public void unregister(PluginCall call) {
        call.unavailable("Push notifications are unavailable in this personal build.");
    }
}
