import jwt from 'jsonwebtoken';

export const auth = (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Please authenticate.' });
        }

        const token = authHeader.slice(7).trim();
        if (!token) return res.status(401).json({ error: 'Please authenticate.' });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded?.id) {
            return res.status(401).json({ error: 'Invalid token.' });
        }

        req.user = { id: String(decoded.id) };
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token.' });
    }
};
