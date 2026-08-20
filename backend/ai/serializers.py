from rest_framework import serializers


class TryOnSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(required=False)
    skin_tone = serializers.CharField(required=False, allow_blank=True)
    body_type = serializers.CharField(required=False, allow_blank=True)
    drape_style = serializers.CharField(required=False, allow_blank=True)
    occasion = serializers.CharField(required=False, allow_blank=True)
    user_photo_base64 = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
    user_photo_media_type = serializers.CharField(required=False, allow_blank=True, default="image/jpeg")
    product_image_url = serializers.URLField(required=False, allow_blank=True)
    vton_category = serializers.ChoiceField(choices=["upper_body", "lower_body", "dresses"], required=False, default="dresses")


class VoiceSearchSerializer(serializers.Serializer):
    transcript = serializers.CharField()
    context = serializers.CharField(required=False, allow_blank=True)
