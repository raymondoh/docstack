import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/client";

export async function uploadProductImage(file: File): Promise<string> {
  // Create a unique filename to prevent overwriting (e.g., "products/1690123456789-thumbnail.png")
  const uniqueFilename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "")}`;
  const storageRef = ref(storage, `products/${uniqueFilename}`);

  // Upload the file
  const uploadTask = await uploadBytesResumable(storageRef, file);

  // Return the securely signed public URL
  const downloadUrl = await getDownloadURL(uploadTask.ref);
  return downloadUrl;
}
