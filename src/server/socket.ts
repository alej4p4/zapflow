import { Server } from "socket.io";
import { logger } from "../lib/logger";

export function setupSocket(io: Server) {
  io.on("connection", (socket) => {
    logger.info("Socket", "Client connected:", socket.id);

    socket.on("disconnect", () => {
      logger.info("Socket", "Client disconnected:", socket.id);
    });

    // Handle joining room for specific WA session
    socket.on("join-session", (sessionId: string) => {
        if (!sessionId || typeof sessionId !== "string") return;
        socket.join(sessionId);
        logger.debug("Socket", `Socket ${socket.id} joined session room: ${sessionId}`);
    });

    // Handle leaving room for specific WA session
    socket.on("leave-session", (sessionId: string) => {
        if (!sessionId || typeof sessionId !== "string") return;
        socket.leave(sessionId);
        logger.debug("Socket", `Socket ${socket.id} left session room: ${sessionId}`);
    });

    // Handle joining user-specific room for notifications
    socket.on("join-user-room", (userId: string) => {
        if (!userId || typeof userId !== "string") return;
        socket.join(`user:${userId}`);
        logger.debug("Socket", `Socket ${socket.id} joined user room: user:${userId}`);
    });
  });
}
