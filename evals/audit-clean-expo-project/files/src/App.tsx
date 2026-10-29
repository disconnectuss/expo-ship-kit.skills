import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Image, Linking, Pressable, Text, TextInput, View } from "react-native";

const PRIVACY_POLICY_URL = "https://splittip.app/privacy";

export function App() {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [receiptUri, setReceiptUri] = useState<string>();
  const [total, setTotal] = useState("");
  const [people, setPeople] = useState("2");

  const openCamera = async () => {
    const result = permission?.granted ? permission : await requestPermission();
    if (result.granted) setCapturing(true);
  };

  const takePhoto = async () => {
    const photo = await camera.current?.takePictureAsync();
    if (photo) setReceiptUri(photo.uri);
    setCapturing(false);
  };

  if (capturing) {
    return (
      <View style={{ flex: 1 }}>
        <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
        <Pressable onPress={takePhoto}>
          <Text>Take photo</Text>
        </Pressable>
        <Pressable onPress={() => setCapturing(false)}>
          <Text>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  const share = Number(total) / Math.max(1, Number(people));
  return (
    <View>
      <TextInput placeholder="Bill total" keyboardType="decimal-pad" value={total} onChangeText={setTotal} />
      <TextInput placeholder="People" keyboardType="number-pad" value={people} onChangeText={setPeople} />
      <Text>Each pays {Number.isFinite(share) ? share.toFixed(2) : "–"}</Text>
      <Pressable onPress={openCamera}>
        <Text>Add a photo of the receipt</Text>
      </Pressable>
      {receiptUri && <Image source={{ uri: receiptUri }} style={{ width: 120, height: 160 }} />}
      <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
        <Text>Privacy policy</Text>
      </Pressable>
    </View>
  );
}
