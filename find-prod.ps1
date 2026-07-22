$ErrorActionPreference = 'Stop'

Write-Host "=== EC2 instances tagged tastile ==="
aws ec2 describe-instances --filters "Name=tag:Name,Values=*tastile*" --query 'Reservations[].Instances[].{Id:InstanceId,Name:Tags[?Key==`Name`]|[0].Value,State:State.Name,Ip:PublicIpAddress,LaunchTime:LaunchTime}' --output table --region ap-northeast-1

Write-Host "=== All EC2 instances (compact) ==="
aws ec2 describe-instances --query 'Reservations[].Instances[].{Id:InstanceId,State:State.Name,Ip:PublicIpAddress,LaunchTime:LaunchTime,Name:Tags[?Key==`Name`]|[0].Value}' --output table --region ap-northeast-1 2>&1 | Select-Object -First 30