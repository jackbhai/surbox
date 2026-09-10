package com.jackbhai.surbox;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // must be registered before super.onCreate() initialises the bridge
        registerPlugin(NativeEqPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
