import { Linking, Pressable, Text, View } from "react-native";

const API_URL = process.env.EXPO_PUBLIC_API_URL;
const PRIVACY_POLICY_URL = "https://splittip.example.dev/privacy";

export function App() {
  return (
    <View>
      <Text>Split the bill, scan the receipt.</Text>
      <Text>Exchange rates from {API_URL}</Text>
      <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
        <Text>Privacy policy</Text>
      </Pressable>
    </View>
  );
}
