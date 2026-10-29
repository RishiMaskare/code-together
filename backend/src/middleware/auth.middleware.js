import jwt from "jsonwebtoken"
import User from "../models/User.js"
import { safeUserProjection } from "../lib/safeUser.js"

export const protectRoute = async (req, res, next) => {
    try {
        const token = req.cookies?.jwt

        if(!token) {
            return res.status(401).json({message: "Unauthorized - No token provided"});
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if(!decoded) {
            return res.status(401).json({message: "Unauthorized - Invalid token"});
        }

        const user = await User.findById(decoded.userId).select(safeUserProjection);

        if(!user) {
            return res.status(401).json({message: "Unauthorized - User not found"});
        }

        req.user = user;

        next();

    } catch (error) {
        if (
            error instanceof jwt.JsonWebTokenError ||
            error instanceof jwt.TokenExpiredError ||
            error instanceof jwt.NotBeforeError
        ) {
            return res.status(401).json({ message: "Unauthorized - Invalid token" });
        }

        console.log("Error in protectRoute middleware", error);
        res.status(500).json({message: "Internal Server Error"});
    }
}