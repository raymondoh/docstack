"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

import { env } from "@/lib/env";
import { adminDb } from "@/lib/firebase/admin";
import { productSchema, type Product } from "@/lib/schemas";

type CreateProductInput = Omit<Product, "id" | "createdAt" | "updatedAt">;

async function requireAdmin() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.email !== env.ADMIN_EMAIL) {
    throw new Error("Unauthorized access");
  }

  return session;
}

export async function createProduct(formData: CreateProductInput) {
  try {
    await requireAdmin();

    const docRef = adminDb.collection("products").doc();

    const completeProductData = {
      ...formData,
      id: docRef.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const parsedData = productSchema.parse(completeProductData);

    await docRef.set(parsedData);

    revalidatePath("/admin/inventory");
    revalidatePath("/");

    return { success: true, id: docRef.id };
  } catch (error: unknown) {
    console.error("❌ Failed to create product:", error);

    if (error instanceof ZodError) {
      return {
        success: false,
        error: error.issues.map(issue => issue.message).join(", ")
      };
    }

    if (error instanceof Error) {
      return { success: false, error: error.message };
    }

    return { success: false, error: "Failed to create product" };
  }
}
