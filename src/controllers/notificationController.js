import Notification from '../models/Notification.js';

export const getNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({
      recipientRole: req.user.role,
      isRead: false
    }).sort({ createdAt: -1 }).limit(20);

    res.status(200).json({ success: true, data: notifications });
  } catch (error) { next(error); }
};

export const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientRole: req.user.role },
      { isRead: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });
    res.status(200).json({ success: true, data: notification });
  } catch (error) { next(error); }
};
